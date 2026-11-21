import type {
  ApiRequest,
  ApiResult,
  Coursework,
  CourseDetail,
  CourseFilters,
  CourseSearchResult,
  DegreeAudit,
  DataFreshness,
  WeekSchedule,
  Profile,
  SurveySubmission,
  TrackingResult,
  Transport,
} from "./types"

function toQuery(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v))
  const text = q.toString()
  return text ? `?${text}` : ""
}

export function createApiClient(transport: Transport) {
  const call = <T>(request: ApiRequest) =>
    transport(request) as Promise<ApiResult<T>>

  return {
    getProfile: () => call<Profile>({ method: "GET", path: "/api/profile" }),
    saveProfile: (profile: Profile) =>
      call<Profile>({ method: "PUT", path: "/api/profile", body: profile }),

    getLatestSurvey: () =>
      call<SurveySubmission | null>({ method: "GET", path: "/api/survey" }),
    submitSurvey: (submission: SurveySubmission) =>
      call<SurveySubmission>({ method: "POST", path: "/api/survey", body: submission }),

    getCoursework: () => call<Coursework>({ method: "GET", path: "/api/coursework" }),
    saveCoursework: (coursework: Coursework) =>
      call<Coursework>({ method: "PUT", path: "/api/coursework", body: coursework }),

    /** #8 answer 1. Provisional shape. */
    getAudit: () => call<DegreeAudit>({ method: "GET", path: "/api/audit" }),
    /** #8 answer 4. Provisional shape. */
    getTracking: () => call<TrackingResult>({ method: "GET", path: "/api/tracking" }),

    /** #21 /courses. Provisional shape (ours). */
    getCourses: (filters: CourseFilters = {}) =>
      call<CourseSearchResult>({ method: "GET", path: `/api/courses${toQuery(filters)}` }),
    getCourse: (id: string) => call<CourseDetail>({ method: "GET", path: `/api/courses/${encodeURIComponent(id)}` }),

    getDataFreshness: () => call<DataFreshness>({ method: "GET", path: "/api/meta/freshness" }),

    /**
     * Deletes the account and every private record. Only resolves ok once
     * everything is gone; a partial failure comes back as an error.
     */
    deleteAccount: () => call<null>({ method: "DELETE", path: "/api/account" }),

    /** weekStart is the Monday, "YYYY-MM-DD". */
    getSchedule: (weekStart: string) =>
      call<WeekSchedule>({ method: "GET", path: `/api/schedule?week=${encodeURIComponent(weekStart)}` }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
