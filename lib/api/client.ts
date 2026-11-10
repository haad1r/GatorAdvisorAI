import type {
  ApiRequest,
  ApiResult,
  Coursework,
  DataFreshness,
  Profile,
  SurveySubmission,
  Transport,
} from "./types"

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

    getDataFreshness: () => call<DataFreshness>({ method: "GET", path: "/api/meta/freshness" }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
