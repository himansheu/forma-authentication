'use strict';
// Prints a strong random value suitable for SESSION_SECRET.
console.log(require('crypto').randomBytes(48).toString('hex'));
