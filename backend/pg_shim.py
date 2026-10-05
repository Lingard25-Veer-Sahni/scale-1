"""Supabase/Postgres-backed, Mongo-compatible async data layer.

server.py was originally written against Motor/PyMongo. Rather than rewrite
~2000 lines of business logic into a hand-designed relational schema, this
module implements just the slice of the Motor API that server.py actually
calls:

    db.<collection>.find_one(filter, projection=None)
    db.<collection>.find(filter, projection=None).sort(field, direction).to_list(n)
    db.<collection>.insert_one(doc)
    db.<collection>.insert_many(docs)
    db.<collection>.update_one(filter, {"$set": {...}} | {"$unset": {...}}, upsert=False)
    db.<collection>.delete_one(filter)
    db.<collection>.count_documents(filter)

...plus the two filter operators actually used anywhere in server.py:
"$ne" and "$in".

Storage model: each Mongo "collection" becomes one Postgres table shaped like

    id  text primary key
    doc jsonb not null default '{}'::jsonb

and every document's own "id" field doubles as the row's primary key. We
talk to it over Supabase's REST API (PostgREST) using the service-role key,
so no direct Postgres connection string / driver (asyncpg, psycopg, ...) is
required - just HTTP, via httpx (already a dependency).

update_one is implemented as a read-merge-write (fetch the existing doc,
apply $set/$unset in Python, PATCH the merged doc back) rather than a
server-side jsonb merge. This app's write volume is low and admin-driven, so
the simplicity is worth the small, harmless race window.
"""
import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


def _value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _filter_to_params(filt: Optional[Dict[str, Any]]) -> List[tuple]:
    """Translate the small, bounded subset of Mongo filter syntax that
    server.py uses into PostgREST query params operating on the jsonb
    `doc` column. httpx percent-encodes these when it builds the URL, so
    values here are left unescaped."""
    params: List[tuple] = []
    for key, cond in (filt or {}).items():
        col = f"doc->>{key}"
        if isinstance(cond, dict):
            if "$ne" in cond:
                params.append((col, f"neq.{_value(cond['$ne'])}"))
            elif "$in" in cond:
                values = ",".join(_value(v) for v in cond["$in"])
                params.append((col, f"in.({values})"))
            else:
                raise NotImplementedError(f"Unsupported filter operator in {cond!r}")
        else:
            params.append((col, f"eq.{_value(cond)}"))
    return params


class _Cursor:
    """Mimics the chainable Motor cursor: find(...).sort(...).to_list(n)."""

    def __init__(self, collection: "PGCollection", filt: Optional[Dict[str, Any]]):
        self._collection = collection
        self._filt = filt or {}
        self._sort_field: Optional[str] = None
        self._sort_dir = 1

    def sort(self, field: str, direction: int = 1) -> "_Cursor":
        self._sort_field = field
        self._sort_dir = direction
        return self

    async def to_list(self, limit: int = 1000) -> List[Dict[str, Any]]:
        params = _filter_to_params(self._filt)
        params.append(("select", "doc"))
        if self._sort_field:
            order = "asc" if self._sort_dir >= 0 else "desc"
            params.append(("order", f"doc->>{self._sort_field}.{order}"))
        params.append(("limit", str(limit)))
        rows = await self._collection._request("GET", params=params)
        return [r["doc"] for r in rows]


class PGCollection:
    def __init__(self, client: "PGClient", name: str):
        self._client = client
        self._name = name

    async def _request(self, method: str, params=None, json_body=None, headers=None):
        rows, _ = await self._client._request_with_headers(
            method, self._name, params=params, json_body=json_body, headers=headers
        )
        return rows

    def find(self, filt: Optional[Dict[str, Any]] = None, projection: Any = None) -> _Cursor:
        return _Cursor(self, filt)

    async def find_one(
        self, filt: Optional[Dict[str, Any]] = None, projection: Any = None
    ) -> Optional[Dict[str, Any]]:
        params = _filter_to_params(filt)
        params.append(("select", "doc"))
        params.append(("limit", "1"))
        rows = await self._request("GET", params=params)
        return rows[0]["doc"] if rows else None

    async def insert_one(self, doc: Dict[str, Any]) -> None:
        row_id = doc.get("id")
        if row_id is None:
            raise ValueError(f"document inserted into '{self._name}' has no 'id' field")
        await self._request(
            "POST", json_body={"id": row_id, "doc": doc}, headers={"Prefer": "return=minimal"}
        )

    async def insert_many(self, docs: List[Dict[str, Any]]) -> None:
        rows = []
        for doc in docs:
            row_id = doc.get("id")
            if row_id is None:
                raise ValueError(f"document inserted into '{self._name}' has no 'id' field")
            rows.append({"id": row_id, "doc": doc})
        if rows:
            await self._request("POST", json_body=rows, headers={"Prefer": "return=minimal"})

    async def update_one(
        self, filt: Dict[str, Any], update: Dict[str, Any], upsert: bool = False
    ) -> None:
        existing = await self.find_one(filt)
        if existing is None:
            if not upsert:
                return
            # Mongo upsert semantics: seed the new doc from the equality
            # terms in the filter (operator conditions like $ne/$in can't
            # seed a concrete value, so they're skipped), then layer $set
            # from the update doc on top.
            new_doc: Dict[str, Any] = {
                k: v for k, v in filt.items() if not isinstance(v, dict)
            }
            new_doc.update(update.get("$set", {}))
            await self.insert_one(new_doc)
            return

        merged = dict(existing)
        merged.update(update.get("$set", {}))
        for key in update.get("$unset", {}):
            merged.pop(key, None)

        params = _filter_to_params(filt)
        await self._request(
            "PATCH", params=params, json_body={"doc": merged}, headers={"Prefer": "return=minimal"}
        )

    async def delete_one(self, filt: Dict[str, Any]) -> None:
        params = _filter_to_params(filt)
        await self._request("DELETE", params=params, headers={"Prefer": "return=minimal"})

    async def count_documents(self, filt: Optional[Dict[str, Any]] = None) -> int:
        params = _filter_to_params(filt)
        params.append(("select", "id"))
        params.append(("limit", "1"))
        _, content_range = await self._client._request_with_headers(
            "GET", self._name, params=params, headers={"Prefer": "count=exact"}
        )
        if content_range and "/" in content_range:
            total = content_range.rsplit("/", 1)[-1]
            if total.isdigit():
                return int(total)
        return 0


class PGClient:
    """Mongo-`db`-shaped wrapper around a Supabase REST (PostgREST) endpoint."""

    def __init__(self, base_url: str, service_key: str):
        self._rest_url = base_url.rstrip("/") + "/rest/v1"
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }
        self._http = httpx.AsyncClient(timeout=20.0)
        self._collections: Dict[str, PGCollection] = {}

    def __getitem__(self, name: str) -> PGCollection:
        return self._get_collection(name)

    def __getattr__(self, name: str) -> PGCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        return self._get_collection(name)

    def _get_collection(self, name: str) -> PGCollection:
        if name not in self._collections:
            self._collections[name] = PGCollection(self, name)
        return self._collections[name]

    async def _request_with_headers(
        self, method: str, table: str, params=None, json_body=None, headers=None
    ):
        url = f"{self._rest_url}/{table}"
        req_headers = {**self._headers, **(headers or {})}
        resp = await self._http.request(method, url, params=params, json=json_body, headers=req_headers)
        if resp.status_code >= 400:
            logger.error("PostgREST %s %s -> %s: %s", method, url, resp.status_code, resp.text)
            resp.raise_for_status()
        content_range = resp.headers.get("content-range")
        if resp.status_code == 204 or not resp.content:
            return [], content_range
        data = resp.json()
        if isinstance(data, list):
            return data, content_range
        return [data], content_range

    async def close(self):
        await self._http.aclose()
