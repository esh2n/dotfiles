// index.mjs — the Worker entrypoint, and nothing else.
//
// workerd requires every named export of the entry module to be a handler
// ("Incorrect type for map entry '<name>': the provided value is not of type
// 'function or ExportedHandler'"), so constants and helpers live in
// src/router.mjs and the pipeline lives in src/app.mjs. This file only exports
// the default handler.

import { handleRequest } from "./app.mjs";

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
