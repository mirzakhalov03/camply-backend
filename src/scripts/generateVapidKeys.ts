import webpush from 'web-push'

// One-time helper: prints a VAPID keypair to paste into env. The public key is
// ALSO the frontend's VITE_VAPID_PUBLIC_KEY (same value, exposed to the client).
const keys = webpush.generateVAPIDKeys()
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey)
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey)
console.log('\nFrontend .env → VITE_VAPID_PUBLIC_KEY=' + keys.publicKey)
