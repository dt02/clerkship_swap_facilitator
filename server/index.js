const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');

const PORT = process.env.PORT || 3001;

async function startServer() {
  await initDb();

  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use('/api/users', require('./routes/users'));
  app.use('/api/users', require('./routes/schedules'));
  app.use('/api/users', require('./routes/desires'));
  app.use('/api/availability', require('./routes/availability'));
  app.use('/api/matching', require('./routes/matching'));
  app.use('/api/site-content', require('./routes/siteContent'));

  const clientBuild = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientBuild, 'index.html'));
    }
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Server startup failed:', error);
  process.exit(1);
});
