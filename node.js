const nacl = require('tweetnacl')
const base64 = require('base64-js')

// Generate an Ed25519 keypair
const keyPair = nacl.sign.keyPair()

// Convert keys to base64 strings
const private_key_base64 = base64.fromByteArray(keyPair.secretKey)
const public_key_base64 = base64.fromByteArray(keyPair.publicKey)

// Print keys in the base64 format
console.log("Private Key (Base64)")
console.log(private_key_base64)

console.log("Public Key (Base64):")
console.log(public_key_base64)