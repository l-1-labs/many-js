import cbor from "cbor";
import { pki } from "node-forge";
import { sha3_224 } from "js-sha3";

import { Identity } from "../identity";
import { Key, KeyPair } from "../keys";
import { OmniError, SerializedOmniError } from "./error";
import { Payload } from "../message";

const ANONYMOUS = Buffer.from([0x00]);
const EMPTY_BUFFER = new ArrayBuffer(0);

const ed25519 = pki.ed25519;

export function encodeEnvelope(payload: Payload, keys?: KeyPair) {
  const publicKey = keys ? keys.publicKey : ANONYMOUS;
  const p = encodeProtectedHeader(publicKey);
  const u = encodeUnprotectedHeader();
  const encodedPayload = cbor.encode(new cbor.Tagged(10001, payload));
  const sig = keys
    ? signStructure(p, encodedPayload, keys.privateKey)
    : EMPTY_BUFFER;
  return cbor.encodeCanonical(new cbor.Tagged(18, [p, u, encodedPayload, sig]));
}

function encodeProtectedHeader(publicKey: Key) {
  const protectedHeader = new Map();
  protectedHeader.set(1, -8); // alg: "Ed25519"
  protectedHeader.set(4, calculateKid(publicKey)); // kid: kid
  protectedHeader.set("keyset", encodeCoseKey(publicKey));
  const p = cbor.encodeCanonical(protectedHeader);
  return p;
}

function encodeUnprotectedHeader() {
  const unprotectedHeader = new Map();
  return unprotectedHeader;
}

export function encodeCoseKey(publicKey: Key) {
  const coseKey = new Map();
  coseKey.set(1, 1); // kty: OKP
  coseKey.set(3, -8); // alg: EdDSA
  coseKey.set(-1, 6); // crv: Ed25519
  coseKey.set(4, [2]); // key_ops: [verify]
  coseKey.set(2, calculateKid(publicKey)); // kid: kid
  coseKey.set(-2, publicKey); // x: publicKey
  return cbor.encodeCanonical([coseKey]);
}

function calculateKid(publicKey: Key) {
  if (Buffer.compare(publicKey, ANONYMOUS) === 0) {
    return ANONYMOUS;
  }
  const kid = new Map();
  kid.set(1, 1);
  kid.set(3, -8);
  kid.set(-1, 6);
  kid.set(4, [2]);
  kid.set(-2, publicKey);
  const pk = "01" + sha3_224(cbor.encodeCanonical(kid));
  return Buffer.from(pk, "hex");
}

export const toIdentity = calculateKid;

function signStructure(p: Buffer, payload: Buffer, privateKey: Key) {
  const message = cbor.encodeCanonical([
    "Signature1",
    p,
    EMPTY_BUFFER,
    payload,
  ]);
  const sig = ed25519.sign({ message, privateKey });
  return Buffer.from(sig);
}

// Add a decoder for tag 10000 (Identity) to cbor
const decoders = {
  10000: (x: Uint8Array) => new Identity(Buffer.from(x)),
};

function mapToObject(m?: Map<any, any>): Object | null {
  return m
    ? Array.from(m).reduce(
        (acc, [key, value]) => Object.assign(acc, { [key]: value }),
        {}
      )
    : null;
}

export function getPayload(buffer: Buffer): object | null {
  const cose = cbor.decodeFirstSync(buffer, { tags: decoders }).value;
  const payload: Map<number, any> = cbor.decodeFirstSync(cose[2]).value;

  // If it's an error, throw it.
  const body = payload.get(4);
  if (typeof body == "object" && !Buffer.isBuffer(body)) {
    throw new OmniError(mapToObject(body) as SerializedOmniError);
  }

  // Decode the body part of the response.
  // TODO: this is opaque blob and networks might return non-CBOR data here, so
  // careful.
  payload.set(4, mapToObject(cbor.decodeFirstSync(body, { tags: decoders })));

  // Transform it into an object for simplicity.
  return mapToObject(payload);
}
