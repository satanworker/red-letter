// Delete every ref the spikes created: refs/heads/spike/* and refs/red-letter/*.
import { api, ok, log, R } from "./lib.mjs";

for (const prefix of ["heads/spike/", "red-letter/"]) {
  for (const { ref } of ok(await api("GET", `${R}/git/matching-refs/${prefix}`), prefix)) {
    // ref names may contain '%': URL-encode each segment or GitHub decodes %2F into '/'.
    const r = await api("DELETE", `${R}/git/${ref.split("/").map(encodeURIComponent).join("/")}`);
    log("DELETE", ref, r.status);
  }
}
