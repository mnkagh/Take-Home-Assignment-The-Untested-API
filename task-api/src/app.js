const express = require('express');
const taskRoutes = require('./routes/tasks');

const app = express();

// Must run before the route handlers, or req.body is undefined and every
// validation would see an empty object. Note the default 100 kB body limit.
app.use(express.json());

// Liveness probe for the deployed service, referenced as healthCheckPath in
// render.yaml. It intentionally does not read the task store, so a cold start
// or a restart still reports healthy. Added for the deployment requirement, not
// part of the original API surface.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/tasks', taskRoutes);

// Central error handler. Four arguments are required for Express to treat this
// as error middleware.
//
// KNOWN BUG (reported as #4, deliberately left unfixed so the failing test
// documents it): this hardcodes 500, discarding the `err.status` that
// body-parser already sets. So a request with a malformed JSON body returns
// "Internal server error" instead of 400, which also means client-side garbage
// pollutes the logs as a server fault. The fix is to respond with
// `err.status || 500` and only log the stack for genuine server errors.
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

// Only listen when run directly, so tests can require this module and drive it
// with Supertest without binding a port. The guard is also why the
// app.listen lines below are the only uncovered lines in the coverage report.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Task API running on port ${PORT}`);
  });
}

module.exports = app;
