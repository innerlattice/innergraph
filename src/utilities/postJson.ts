// POST a JSON body: how this app talks to model runtimes and OpenAI's sign-in endpoints.
export function postJson(http: typeof fetch, url: string, body: unknown): Promise<Response> {
  return http(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
