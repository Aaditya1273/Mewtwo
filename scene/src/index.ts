import './modules/compatibility/polyfill/declares'
import { bootstrapLinger } from './linger/bootstrap'

export * from '@dcl/sdk'

export function main() {
  bootstrapLinger()
}
