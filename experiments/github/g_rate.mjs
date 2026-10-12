// G: rate-limit headers observed on core REST, GraphQL, /rate_limit.
import { api, gql, log, R } from "./lib.mjs";

const hdrs = (r) => Object.fromEntries([...r.headers].filter(([k]) => /ratelimit|retry-after|x-github-request-id/.test(k)));
let r = await api("GET", `${R}/git/ref/heads/main`);
log("REST core GET", r.status, hdrs(r));
r = await gql(`{ repository(owner:"satanworker", name:"red-letter"){ ref(qualifiedName:"refs/heads/main"){ target{ oid } } } rateLimit{ cost limit remaining used resetAt } }`);
log("GraphQL", r.status, hdrs(r), r.json.data.rateLimit);
r = await api("GET", "/rate_limit");
log("/rate_limit", r.status, "counts against core?", hdrs(r)["x-ratelimit-used"], Object.fromEntries(Object.entries(r.json.resources).map(([k, v]) => [k, `${v.used}/${v.limit}`])));
