import cbor from "cbor"
import { AnonymousIdentity } from "../../../identity"
import { Message } from "../../../message"
import { Network } from "../../network"
import type { NetworkModule } from "../types"

const ONE_MINUTE = 60000
const ONE_SECOND = 1000
const sleep = async (time: number) => new Promise(r => setTimeout(r, time))

interface Async extends NetworkModule {
  handleAsyncToken: (message: Message, n?: Network) => Promise<unknown>
}

export const Async: Async = {
  _namespace_: "async",

  async handleAsyncToken(message: Message, n?: Network) {
    const asyncToken = message.getAsyncToken()
    return asyncToken
      ? await fetchAsyncStatus(
          n ?? new Network(this.url, new AnonymousIdentity()),
          asyncToken,
        )
      : message
  },
}

async function fetchAsyncStatus(
  n: Network,
  asyncToken: ArrayBuffer,
): Promise<Message> {
  const start = new Date().getTime()
  let waitTime = ONE_SECOND
  let isDurationReached = false
  let res = new Message(new Map())

  while (!isDurationReached) {
    res = (await n.call("async.status", new Map([[0, asyncToken]]))) as Message
    const payload = res.getPayload()
    if (payload) {
      if (payload.has(0)) {
        const asyncResult = payload.get(0)
        if (asyncResult === 3 && payload.has(1)) {
          const msg = cbor.decode(payload.get(1)).value
          return new Message(msg)
        }
      }
    }
    const now = new Date().getTime()
    isDurationReached = now - start >= ONE_MINUTE
    await sleep(waitTime)
    waitTime *= 1.5
  }

  return res
}
