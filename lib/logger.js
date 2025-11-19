function nowIso() {
  return new Date().toISOString();
}

function serialize(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return String(obj);
  }
}

function base(event, fields = {}) {
  const payload = { ts: nowIso(), event, ...fields };
  return serialize(payload);
}

function info(message, fields = {}) {
  console.log(base('info', { message, ...fields }));
}

function warn(message, fields = {}) {
  console.warn(base('warn', { message, ...fields }));
}

function error(message, fields = {}) {
  console.error(base('error', { message, ...fields }));
}

module.exports = { info, warn, error };