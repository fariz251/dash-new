module.exports = (_req, res) => {
  const now = new Date();
  const intervalMs = 15 * 60 * 1000;
  const next = new Date(Math.ceil(now.getTime() / intervalMs) * intervalMs);
  res.status(200).json({ server_time: now.toISOString(), next_refresh: next.toISOString() });
};
