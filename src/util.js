'use strict';

const crypto = require('crypto');

/** Public, non-secret handle for a session row. The real sid never leaves the server. */
function publicSessionId(sid) {
  return crypto.createHash('sha256').update(sid).digest('hex').slice(0, 16);
}

/** "Chrome on macOS" from a user-agent string. Deliberately coarse. */
function describeAgent(ua) {
  if (!ua) return 'Unknown device';
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let os = '';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return os ? `${browser} on ${os}` : browser;
}

module.exports = { publicSessionId, describeAgent };
