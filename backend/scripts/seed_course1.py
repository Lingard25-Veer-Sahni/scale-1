"""One-time data-population script for Course 1 ("Personal Finance & Money
Decisions"), lessons 1-5.

Why this is a standalone script and not startup-seed logic in server.py:
each lesson needs real uploaded PDF file_refs (summary + ppt) created via the
Supabase Storage layer first, with real file IDs baked into the lesson docs.
That's a one-time, source-data-driven population step, not something safe to
blindly recreate on every cold start like the generic events/sessions/team
seed defaults are.

Usage (from backend/, with the real .venv or any venv with the project's
deps — httpx, python-dotenv, pydantic — installed):

    python3 scripts/seed_course1.py

Safe to re-run: upserts the course by slug and each lesson by
(course_id, order) — re-running won't create duplicate rows, it just
refreshes content/file uploads.
"""
import asyncio
import sys
import uuid
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT_DIR))

from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

import os
from pg_shim import PGClient
from storage_service import put_object, build_upload_path

DOWNLOADS = Path("/Users/veersinghsahni/Downloads")

supabase_url = os.environ["SUPABASE_URL"]
supabase_key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
db = PGClient(supabase_url, supabase_key)


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def upload_material(path: Path) -> str:
    """Uploads a PDF to Supabase Storage, creates a file_refs row with
    kind='course_material', returns the new FileRef id."""
    data = path.read_bytes()
    storage_path = build_upload_path("course-materials", "pdf")
    result = put_object(storage_path, data, "application/pdf")
    ref_id = str(uuid.uuid4())
    ref = {
        "id": ref_id,
        "storage_path": result["path"],
        "original_filename": path.name,
        "content_type": "application/pdf",
        "size": int(result.get("size") or len(data)),
        "kind": "course_material",
        "created_at": now_iso(),
        "is_deleted": False,
    }
    await db.file_refs.insert_one(ref)
    print(f"  uploaded {path.name} -> file_refs/{ref_id}")
    return ref_id


LESSONS = [
    {
        "order": 1,
        "title": "Needs, Wants & Money Choices",
        "youtube_url": "https://youtu.be/TGvTFQm_hII",
        "summary": DOWNLOADS / "SCALE-C1-L01-Summary-bb3f6a4f.pdf",
        "ppt": DOWNLOADS / "SCALE-C1-L01-Ppt-ba5a9cdc.pdf",
        "quiz": [
            ("Which of these is the best definition of a need?",
             ["Something you enjoy having", "Something essential for daily life, health, or learning", "Something expensive", "Something you buy every week"], 1,
             "A need is essential for daily life, health, or learning."),
            ("Which of these is a want?",
             ["Basic medicines", "Transport to school", "New sneakers when your old ones are still fine", "A required school uniform"], 2,
             "The old sneakers still work, so new ones are enjoyable, not essential."),
            ("Do needs look the same for everyone?",
             ["Yes - everyone has identical needs", "No - needs depend on your situation and circumstances", "Yes - a need is always a want", "No - only adults have needs"], 1,
             "Needs depend on your circumstances."),
            ("A working phone you need for schoolwork is a ___. The latest model when yours works fine is a ___.",
             ["want; need", "need; want", "need; need", "want; want"], 1,
             "The same thing can be a need or a want, depending on your situation."),
            ("Which of these is NOT one of the three questions to ask before you spend?",
             ["Is this a need for me, or a want?", "Can I afford it without borrowing?", "What am I giving up if I buy this?", "Will my friends be impressed?"], 3,
             "The three questions are need/want, afford without borrowing, and what you give up."),
            ("Priya has ₹500. Her science practical book costs ₹250 and bus fare is ₹100. How much is left?",
             ["₹100", "₹150", "₹250", "₹400"], 1,
             "₹500 - ₹250 - ₹100 = ₹150."),
            ("The game cosmetic costs ₹400. Priya has saved ₹150 toward it. How much more does she need?",
             ["₹150", "₹200", "₹250", "₹300"], 2,
             "₹400 - ₹150 = ₹250 short."),
            ("What should Priya do first?",
             ["Buy the game cosmetic right away", "Borrow ₹250 to get the cosmetic now", "Buy the practical book - needs come first", "Stop taking the bus to save ₹100"], 2,
             "Cover essential needs first, then plan for wants. The bus is also a need."),
        ],
    },
    {
        "order": 2,
        "title": "Scarcity & Opportunity Cost",
        "youtube_url": "https://youtu.be/6YodKtnptJA",
        "summary": DOWNLOADS / "SCALE-C1-L02-Summary-9ce333dd.pdf",
        "ppt": DOWNLOADS / "SCALE-C1-L02-Ppt-64c364b5.pdf",
        "quiz": [
            ("Which situation best shows scarcity?",
             ["A student cannot fit every activity into one afternoon", "A shop has no price labels", "A person forgets a password", "A bank prints a statement"], 0,
             "Time is limited, so the student must choose."),
            ("Opportunity cost is best described as...",
             ["The sum of every rejected option", "The next-best alternative given up", "Only the cash price", "A penalty paid to a bank"], 1,
             "It is the value of the next-best alternative forgone."),
            ("Priya spends her ₹150 saving at the cinema. How much saving progress does she give up?",
             ["₹400", "₹250", "₹150", "₹550"], 2,
             "Her existing saving falls by ₹150."),
            ("Can a free activity have an opportunity cost?",
             ["No, because its price is zero", "Only if it uses a debit card", "No, if you enjoy it", "Yes, because it uses time"], 3,
             "Time spent there cannot be used for the next-best activity."),
            ("Choosing a ₹300 book instead of your only alternative, a ₹300 outing, gives up...",
             ["The outing", "₹600", "Every possible purchase", "Nothing"], 0,
             "The outing is the next-best alternative."),
            ("Which is a constraint?",
             ["A favourite colour", "A two-hour time limit", "An advertising slogan", "A dream destination"], 1,
             "A limit on available time restricts feasible choices."),
            ("Who faces scarcity?",
             ["Only people without jobs", "Only students", "Everyone, because some resources are limited", "Only borrowers"], 2,
             "Even wealthy people have limited time and other resources."),
            ("Which explanation uses opportunity cost correctly?",
             ["I bought it because it was advertised", "I added every alternative price", "Saving is always the best choice", "I chose revision and gave up my next-best use, a film"], 3,
             "It identifies the chosen use and next-best use forgone."),
        ],
    },
    {
        "order": 3,
        "title": "Goals & Trade-offs",
        "youtube_url": "https://youtu.be/6jRndeVhdMs",
        "summary": DOWNLOADS / "L3- summary.pdf",
        "ppt": DOWNLOADS / "L3- slides.pdf",
        "quiz": [
            ("Which is the most workable goal?",
             ["Save more someday", "Buy something nice", "Save ₹800 monthly for six months toward a coursework tablet", "Become rich quickly"], 2,
             "It specifies an amount, timing and purpose."),
            ("Meera needs ₹6,000 and has ₹1,200. What is her gap?",
             ["₹7,200", "₹6,000", "₹1,200", "₹4,800"], 3,
             "₹6,000 minus ₹1,200 equals ₹4,800."),
            ("How much monthly saving closes a ₹4,800 gap in six months, ignoring returns?",
             ["₹800", "₹600", "₹1,000", "₹4,800"], 0,
             "₹4,800 divided by 6 equals ₹800."),
            ("At ₹600 per month, how long does a ₹4,800 gap take?",
             ["6 months", "8 months", "4 months", "12 months"], 1,
             "₹4,800 divided by ₹600 equals 8."),
            ("Why check the budget after calculating a contribution?",
             ["To make the target look larger", "Because every goal must earn interest", "A required amount may be unaffordable", "To avoid choosing a deadline"], 2,
             "The budget shows whether the contribution fits real resources."),
            ("Two goals cost ₹2,100 together. Three months of ₹500 saving leaves what shortfall?",
             ["₹1,600", "₹1,500", "₹500", "₹600"], 3,
             "₹2,100 minus ₹1,500 equals ₹600."),
            ("Which is a valid trade-off when a goal is unaffordable?",
             ["Extend the deadline if the need allows", "Pretend uncertain income is guaranteed", "Ignore essential bills", "Remove the target amount"], 0,
             "Changing the deadline can reduce the monthly contribution."),
            ("What should a fallback plan do?",
             ["Promise the price will never change", "State what changes if an assumption fails", "Require disclosure of family finances", "Assume every goal has equal priority"], 1,
             "It explains how to respond when costs or available money change."),
        ],
    },
    {
        "order": 4,
        "title": "Money Habits & Persuasion",
        "youtube_url": "https://youtu.be/k890aewbKBM",
        "summary": DOWNLOADS / "L4- summary.pdf",
        "ppt": DOWNLOADS / "L4- slides.pdf",
        "quiz": [
            ("A countdown most directly uses which pressure?",
             ["Urgency", "Compound interest", "A tax deduction", "Diversification"], 0,
             "It encourages a faster decision by stressing limited time."),
            ("At ₹99 monthly, twelve paid months cost...",
             ["₹990", "₹1,188", "₹1,099", "₹99"], 1,
             "₹99 multiplied by 12 is ₹1,188."),
            ("What should you check before starting a free trial?",
             ["Only the logo", "Only the first day price", "Renewal and cancellation terms", "How many friends use it"], 2,
             "A trial may become a paid subscription."),
            ("Income and spending both rise by ₹1,000. Extra saving is...",
             ["₹2,000", "₹1,000", "₹500", "₹0"], 3,
             "All the additional income has been used by additional spending."),
            ("Which is a useful pause for non-essential purchases?",
             ["Add to a wish list and review later", "Always borrow immediately", "Ignore the full price", "Buy because everyone else did"], 0,
             "A delay separates the trigger from the buying decision."),
            ("What is 25% off an ₹800 item?",
             ["₹750 sale price", "₹600 sale price", "₹200 sale price", "₹1,000 sale price"], 1,
             "The discount is ₹200; ₹800 minus ₹200 equals ₹600."),
            ("Buying an unplanned ₹600 item advertised as saving ₹200 means...",
             ["Your bank saving rises ₹200", "You spent nothing", "You still spent ₹600", "You earned ₹800"], 2,
             "A discount is a lower price, not cash added to savings."),
            ("Which statement treats social proof critically?",
             ["Everyone has it, so I need it", "Popular products are always scams", "Advertising is always false", "Popularity does not prove it fits my needs"], 3,
             "Suitability depends on purpose, cost and alternatives, not popularity."),
        ],
    },
    {
        "order": 5,
        "title": "Income & Cash Flow",
        "youtube_url": "https://youtu.be/a01Aze4GMaE",
        "summary": DOWNLOADS / "L5- summary.pdf",
        "ppt": DOWNLOADS / "L5- slides.pdf",
        "quiz": [
            ("Which income is regular?",
             ["A monthly allowance", "A festival gift", "Selling an old bicycle", "A one-time prize"], 0,
             "It repeats on a schedule."),
            ("Arjun starts with ₹800, receives ₹600 and spends ₹950. His ending balance is?",
             ["₹1,450", "₹450", "₹250", "₹950"], 1,
             "₹800 + ₹600 − ₹950 = ₹450."),
            ("A balance is best described as",
             ["money moving during a month", "the amount held at one moment", "only income from work", "a yearly total"], 1,
             "It is a snapshot, not a movement."),
            ("Which is irregular income?",
             ["A fixed monthly allowance", "Tutoring pay that changes month to month", "A salary credited on the same date", "A bus pass"], 1,
             "It varies and is not guaranteed every month."),
            ("Why plan essentials on regular income?",
             ["It is always the largest amount", "It is the part you can count on", "Gifts cannot be spent", "Irregular income is taxed"], 1,
             "Reliable income is the safest base for essential costs."),
            ("Zoya gets ₹500 monthly and a ₹2,000 one-off gift. Her monthly baseline is?",
             ["₹2,500", "₹2,000", "₹500", "₹700"], 2,
             "The gift happens once, so it is not monthly income."),
            ("One sensible use of a one-off gift is",
             ["a new permanent monthly expense", "a one-time purchase or saving", "raising the monthly budget", "ignoring it in records"], 1,
             "One-off money suits one-time uses."),
            ("If a month's spending exceeds income by ₹200, the balance",
             ["rises ₹200", "falls ₹200", "stays unchanged", "doubles"], 1,
             "Outflow above inflow reduces the balance."),
        ],
    },
    {
        "order": 6,
        "title": "Building a Workable Budget",
        "youtube_url": "https://www.youtube.com/watch?v=pQ7dJe5PTNA",
        "summary": DOWNLOADS / "L6- summary.pdf",
        "ppt": DOWNLOADS / "L6- slides.pdf",
        "quiz": [
            ("Which is a fixed expense?",
             ["Weekly snacks", "A monthly bus pass", "A festival gift", "A phone repair"], 1,
             "It repeats at the same amount."),
            ("An annual exam fee is best classed as",
             ["fixed", "variable", "occasional", "income"], 2,
             "It is rare but predictable."),
            ("With twelve months to save, an ₹1,800 annual fee needs what monthly set-aside?",
             ["₹180", "₹150", "₹300", "₹120"], 1,
             "₹1,800 divided by 12 equals ₹150."),
            ("Kabir: income ₹1,500, planned costs ₹1,100. His surplus is?",
             ["₹400", "₹2,600", "₹1,100", "₹500"], 0,
             "₹1,500 − ₹1,100 = ₹400."),
            ("Why spread annual costs into monthly slices?",
             ["To make fees cheaper", "So known rare costs surprise the plan less", "To avoid paying the fee", "To increase income"], 1,
             "Monthly set-asides reduce the surprise of known costs."),
            ("The fifty-thirty-twenty split is best treated as",
             ["a legal requirement", "a universal rule", "one possible starting guide", "a tax rate"], 2,
             "Budgeting approaches vary; no single rule fits everyone."),
            ("A budget is workable when",
             ["spending equals zero", "planned spending and saving fit within income", "wants are removed", "income is ignored"], 1,
             "Balance is the test."),
            ("'Pay yourself first' means",
             ["spending before bills", "moving a set amount to saving when income arrives", "paying others first", "borrowing early"], 1,
             "Saving happens first, not from leftovers."),
        ],
    },
    {
        "order": 7,
        "title": "Tracking & Adjusting",
        "youtube_url": "https://youtu.be/nTwYz2vjAcI?si=JpdFXoh5n7Wy6F9_",
        "summary": DOWNLOADS / "L7- summary.pdf",
        "ppt": DOWNLOADS / "L7- slides.pdf",
        "quiz": [
            ("A spending log's main job is to",
             ["replace the budget", "show actual spending to compare with the plan", "list wishes", "track friends' spending"], 1,
             "Comparison with the plan is the point."),
            ("Rohan planned ₹600 and spent ₹820. The shortfall is?",
             ["₹1,420", "₹220", "₹120", "₹820"], 1,
             "₹820 − ₹600 = ₹220."),
            ("After finding a shortfall, the first step is to",
             ["cut the biggest category", "borrow money", "diagnose the cause", "close the account"], 2,
             "The cause decides the fix."),
            ("When income falls, which is adjusted last?",
             ["Flexible snacks", "Saving target", "Essential fixed costs", "Subscriptions"], 2,
             "Essentials are protected first."),
            ("Sana planned ₹500 and spent ₹640. Her gap is?",
             ["₹140", "₹1,140", "₹40", "₹240"], 0,
             "₹640 − ₹500 = ₹140."),
            ("Rohan's revised plan: 400 fixed + 350 variable + 150 saving + 100 fee fund. It works because",
             ["it totals his new ₹1,000 income", "it removes all spending", "it doubles income", "it hides the fee"], 0,
             "The plan balances inside the new income."),
            ("A one-off repair cost is best handled by",
             ["cutting a category forever", "treating it as occasional and planning a set-aside", "ignoring it", "counting it as income"], 1,
             "Occasional costs get monthly slices."),
            ("How often does this lesson suggest reviewing?",
             ["Yearly", "Weekly", "Never", "Hourly"], 1,
             "A short weekly review keeps the plan honest."),
        ],
    },
    {
        "order": 8,
        "title": "Buying with Judgment",
        "youtube_url": "https://youtu.be/vrzZcP1zFJM",
        "summary": DOWNLOADS / "L8- summary.pdf",
        "ppt": DOWNLOADS / "L8- slides.pdf",
        "quiz": [
            ("A 500 g bag costs ₹45; a 1 kg bag costs ₹80. The unit prices are?",
             ["₹45 vs ₹80", "₹90/kg vs ₹80/kg", "₹80/kg vs ₹90/kg", "Equal"], 1,
             "₹45 × 2 = ₹90 per kg; the 1 kg bag is ₹80 per kg."),
            ("40% off a ₹999 jacket means paying about",
             ["₹400", "₹999", "₹599", "₹699"], 2,
             "₹999 × 60% = ₹599.40, about ₹599; the discount vs list price is ₹399.60."),
            ("A ₹149 monthly subscription costs per year",
             ["₹149", "₹1,488", "₹1,788", "₹1,049"], 2,
             "₹149 × 12 = ₹1,788, assuming no price change."),
            ("Printer A costs ₹2,500 with ₹900 yearly ink; printer B costs ₹3,400 with ₹300 yearly ink. Over two years?",
             ["A is cheaper", "B is cheaper at ₹4,000 vs ₹4,300", "They are equal", "Ink does not matter"], 1,
             "A: 2,500 + 1,800 = 4,300. B: 3,400 + 600 = 4,000."),
            ("Buy two get one free on a ₹150 item. Effective price each?",
             ["₹150", "₹75", "₹100", "₹50"], 2,
             "₹300 ÷ 3 = ₹100."),
            ("The best reason to skip a discount is",
             ["the discount is large", "you did not need the item", "the shop is nearby", "friends are buying"], 1,
             "An unneeded purchase is spending, not saving."),
            ("Which is a misleading sales tactic?",
             ["Clear unit pricing", "A countdown timer pressuring instant purchase", "Printed ingredients", "A receipt"], 1,
             "Artificial urgency pushes unplanned buying."),
            ("Total ownership cost includes",
             ["only the price tag", "purchase price plus running costs over its life", "only repairs", "the discount"], 1,
             "Keeping it working is part of the cost."),
        ],
    },
    {
        "order": 9,
        "title": "What Financial Accounts Do",
        "youtube_url": "https://youtu.be/gZFKrM5pExs",
        "summary": Path("/Users/veersinghsahni/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/9B8B361A-E503-4D9C-ACD9-7F37ADB1D135/L9- summary.pdf"),
        "ppt": DOWNLOADS / "L9- slides.pdf",
        "quiz": [
            ("An everyday transaction account is best for",
             ["locking money for a year", "everyday money in and out", "earning the highest interest", "avoiding all records"], 1,
             "It is built for daily deposits and payments; in India a savings bank account often serves this role too."),
            ("A savings account usually",
             ["earns some interest while staying reachable", "cannot be touched for a year", "charges no possible fees", "is only for salaries"], 0,
             "It usually grows gently and stays accessible, though fees can eat into earnings."),
            ("A fixed deposit's main trade-off is",
             ["no interest at all", "locking access in exchange for usually higher interest", "instant spending", "no records"], 1,
             "You give up quick access for usually stronger growth, though not always."),
            ("Dev locks ₹200 in a one-year deposit. Leaving early may",
             ["double his money", "reduce or remove the interest benefit", "cancel the account", "remove all fees"], 1,
             "Early withdrawal is often allowed subject to terms, and can cost interest."),
            ("Which is NOT one of the four comparison questions?",
             ["What is it for?", "How fast can I reach it?", "What colour is the card?", "What are the restrictions?"], 2,
             "Purpose, access, cost and restrictions matter; looks do not."),
            ("Zoya's ₹500 she might need anytime belongs in",
             ["a one-year fixed deposit", "the savings account", "a locked box at home", "someone else's account"], 1,
             "Savings keeps it growing yet reachable."),
            ("Money for exam books next year could sit in",
             ["daily spending cash", "savings or a short deposit", "a friend's wallet", "a shopping app balance"], 1,
             "Near-term goals suit savings or a short deposit."),
            ("Why check an account's fees before opening it?",
             ["Fees increase interest", "Costs can quietly reduce your balance", "Fees are illegal", "To get a better colour card"], 1,
             "Fees and minimum balances are part of the real cost."),
        ],
    },
]


async def main():
    course = await db.courses.find_one({"slug": "personal-finance-money-decisions"})
    if not course:
        course = {
            "id": str(uuid.uuid4()),
            "slug": "personal-finance-money-decisions",
            "title": "Personal Finance & Money Decisions",
            "subtitle": "How to manage money: budgeting, banking and UPI, earning and taxes, debt, insurance, scams and planning major goals.",
            "description": (
                "How to manage money: budgeting, banking and UPI, earning and taxes, debt, "
                "insurance, scams and planning major goals. Ends with building a personal "
                "financial plan."
            ),
            "published": True,
            "order": 1,
            "created_at": now_iso(),
        }
        await db.courses.insert_one(course)
        print(f"Created course {course['id']} ({course['slug']})")
    else:
        print(f"Course already exists: {course['id']} ({course['slug']})")

    course_id = course["id"]

    for spec in LESSONS:
        print(f"\nLesson {spec['order']}: {spec['title']}")
        existing = await db.lessons.find({"course_id": course_id}, {"_id": 0}).to_list(500)
        match = next((l for l in existing if l.get("order") == spec["order"]), None)

        # If the source PDF is no longer in ~/Downloads (already uploaded on a
        # prior run, then cleaned up locally), keep whatever file_refs id is
        # already on the existing lesson instead of overwriting it with None
        # — otherwise re-running this script after Downloads gets tidied up
        # silently breaks previously-working lesson PDF links.
        if spec["summary"].exists():
            summary_id = await upload_material(spec["summary"])
        else:
            summary_id = match.get("summary_pdf_id") if match else None
        if spec["ppt"].exists():
            ppt_id = await upload_material(spec["ppt"])
        else:
            ppt_id = match.get("ppt_pdf_id") if match else None

        quiz = [
            {
                "id": str(uuid.uuid4()),
                "question": q,
                "options": opts,
                "correct_index": correct,
                "explanation": expl,
            }
            for (q, opts, correct, expl) in spec["quiz"]
        ]

        doc = {
            "course_id": course_id,
            "order": spec["order"],
            "title": spec["title"],
            "youtube_url": spec["youtube_url"],
            "summary_pdf_id": summary_id,
            "ppt_pdf_id": ppt_id,
            "quiz": quiz,
            "passing_pct": 60,
        }

        if match:
            doc["id"] = match["id"]
            await db.lessons.update_one({"id": match["id"]}, {"$set": doc})
            print(f"  updated lesson {match['id']}")
        else:
            doc["id"] = str(uuid.uuid4())
            doc["created_at"] = now_iso()
            await db.lessons.insert_one(doc)
            print(f"  created lesson {doc['id']}")

    print("\nDone.")
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
