import { orderFulfilHandler as h } from '../src/distributed/handler/com_order_fulfil/index.js';
const _ = h;
export async function probe(): Promise<string> {
  return String(_);
}
