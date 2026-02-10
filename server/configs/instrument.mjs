import * as Sentry from "@sentry/node";

Sentry.init({
    dsn: "https://2a584d0e289a5ba1203fafce31b75992@o4510861352173568.ingest.us.sentry.io/4510861354139648",
    sendDefaultPii: true,
});
