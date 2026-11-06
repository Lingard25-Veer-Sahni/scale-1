import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;
const BASE_URL = BACKEND_URL;

export const api = axios.create({ baseURL: API, timeout: 20000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("scale_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const authApi = {
  login: (email, password) => api.post("/auth/login", { email, password }).then((r) => r.data),
  signup: (email, password, name) => api.post("/auth/signup", { email, password, name }).then((r) => r.data),
  me: () => api.get("/auth/me").then((r) => r.data),
};

export const contentApi = {
  get: () => api.get("/content").then((r) => r.data),
  put: (payload) => api.put("/content", payload).then((r) => r.data),
};

export const themeApi = {
  get: () => api.get("/theme").then((r) => r.data),
  put: (payload) => api.put("/theme", payload).then((r) => r.data),
};

export const eventsApi = {
  list: () => api.get("/events").then((r) => r.data),
  get: (id) => api.get(`/events/${id}`).then((r) => r.data),
  create: (payload) => api.post("/events", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/events/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/events/${id}`).then((r) => r.data),
};

export const sessionsApi = {
  list: () => api.get("/sessions").then((r) => r.data),
  create: (payload) => api.post("/sessions", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/sessions/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/sessions/${id}`).then((r) => r.data),
};

export const formsApi = {
  contact: (payload) => api.post("/forms/contact", payload).then((r) => r.data),
  eventScholarship: (payload) => api.post("/forms/event-scholarship", payload).then((r) => r.data),
};

export const uploadsApi = {
  scholarshipProof: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/upload/scholarship-proof", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  // Generic public image upload (Community/Team photos + galleries). Returns
  // {id, original_filename, size} — build a displayable URL with imageUrl().
  image: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/upload/image", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  imageUrl: (fileId) => `${BASE_URL}/api/uploads/${fileId}`,
};

export const registrationsApi = {
  create: (payload) => api.post("/registrations", payload).then((r) => r.data),
  get: (id) => api.get(`/registrations/${id}`).then((r) => r.data),
  list: () => api.get("/admin/registrations").then((r) => r.data),
};

export const submissionsApi = {
  list: () => api.get("/submissions").then((r) => r.data),
  remove: (id) => api.delete(`/submissions/${id}`).then((r) => r.data),
};

export const paymentsApi = {
  createOrder: (registration_id) =>
    api.post("/payments/create-order", { registration_id }).then((r) => r.data),
  status: (order_id) => api.get(`/payments/status/${order_id}`).then((r) => r.data),
};

export const communityApi = {
  list: () => api.get("/community").then((r) => r.data),
  create: (payload) => api.post("/community", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/community/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/community/${id}`).then((r) => r.data),
};

export const teamApi = {
  list: () => api.get("/team").then((r) => r.data),
  create: (payload) => api.post("/team", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/team/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/team/${id}`).then((r) => r.data),
};

export const pagesApi = {
  list: () => api.get("/pages").then((r) => r.data),
  adminList: () => api.get("/admin/pages").then((r) => r.data),
  get: (slug) => api.get(`/pages/${slug}`).then((r) => r.data),
  create: (payload) => api.post("/pages", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/pages/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/pages/${id}`).then((r) => r.data),
};

export const eventMaterialsApi = {
  get: (eventId, regId) =>
    api.get(`/events/${eventId}/materials`, { params: regId ? { reg_id: regId } : {} })
      .then((r) => r.data),
  update: (eventId, payload) =>
    api.put(`/events/${eventId}/materials`, payload).then((r) => r.data),
  uploadFile: (eventId, file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/events/${eventId}/files`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  downloadUrl: (eventId, fileId, regId, token) => {
    const qs = new URLSearchParams();
    if (regId) qs.set("reg_id", regId);
    if (token) qs.set("_t", token);
    const base = BASE_URL || "";
    return `${base}/api/events/${eventId}/files/${fileId}/download?${qs.toString()}`;
  },
};

// --- Courses / LMS (SCALE Courses) ---
// Learner identity is a separate, lightweight signup (name+email -> JWT),
// deliberately kept apart from the admin/user "scale_token" above so a
// learner session never collides with an admin session in the same browser.
// A dedicated axios instance + interceptor keeps that token out of every
// other request, and lets a learner call stay anonymous (no Authorization
// header at all) if no learner token is present yet — those public reads
// just hit `api` directly instead.
export const learnerApi = axios.create({ baseURL: API, timeout: 20000 });
learnerApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("scale_learner_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const coursesApi = {
  list: () => api.get("/courses").then((r) => r.data),
  get: (slug) => api.get(`/courses/${slug}`).then((r) => r.data),
  progress: (slug) => learnerApi.get(`/courses/${slug}/progress`).then((r) => r.data),
  certificateUrl: (slug) => `${BASE_URL}/api/courses/${slug}/certificate`,
  // Admin CRUD
  adminList: () => api.get("/admin/courses").then((r) => r.data),
  adminCreate: (payload) => api.post("/admin/courses", payload).then((r) => r.data),
  adminUpdate: (id, payload) => api.put(`/admin/courses/${id}`, payload).then((r) => r.data),
  adminRemove: (id) => api.delete(`/admin/courses/${id}`).then((r) => r.data),
  adminListLessons: (courseId) => api.get(`/admin/courses/${courseId}/lessons`).then((r) => r.data),
  adminCreateLesson: (courseId, payload) => api.post(`/admin/courses/${courseId}/lessons`, payload).then((r) => r.data),
  adminUpdateLesson: (lessonId, payload) => api.put(`/admin/lessons/${lessonId}`, payload).then((r) => r.data),
  adminRemoveLesson: (lessonId) => api.delete(`/admin/lessons/${lessonId}`).then((r) => r.data),
  adminUploadMaterial: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/admin/course-materials/upload", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  materialUrl: (fileId) => `${BASE_URL}/api/course-materials/${fileId}`,
};

export const learnersApi = {
  signup: (name, email) => api.post("/learners/signup", { name, email }).then((r) => r.data),
  me: () => learnerApi.get("/learners/me").then((r) => r.data),
  submitQuiz: (lessonId, answers) =>
    learnerApi.post(`/lessons/${lessonId}/quiz/submit`, { answers }).then((r) => r.data),
};

export const eventSubmissionsApi = {
  upload: (eventId, regId, file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/events/${eventId}/submission-files`, form, {
      params: { reg_id: regId },
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  submit: (eventId, payload) =>
    api.post(`/events/${eventId}/submissions`, payload).then((r) => r.data),
  mine: (eventId, regId) =>
    api.get(`/events/${eventId}/submissions/mine`, { params: { reg_id: regId } })
      .then((r) => r.data),
  adminList: (eventId) =>
    api.get(`/admin/events/${eventId}/submissions`).then((r) => r.data),
  exportUrl: (eventId) => `${BASE_URL}/api/admin/events/${eventId}/submissions/export`,
};
