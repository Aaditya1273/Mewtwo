import { MikroORM } from '@mikro-orm/core'
import type { MongoDriver } from '@mikro-orm/mongodb'
import { MongoEntityManager } from '@mikro-orm/mongodb'

/**
 * MikroORM connection.
 *
 * Structure retained from the MRT-Backrooms donor project (Apache-2.0, see
 * THIRD_PARTY_NOTICES.md). The donor hardcoded its own three entities here; this version
 * takes them as an argument so it belongs to no particular feature.
 *
 * Nothing calls this yet. It exists because `MongoPersistence` — the durable
 * `SocialPersistence` adapter — is the next piece of work, and this is the connection
 * plumbing it will use. `LINGER_PERSISTENCE=mongo` currently throws a clear
 * not-implemented error rather than half-using this.
 */

export const DI = {} as {
  orm: MikroORM
  em: MongoEntityManager
}

export async function connect(entities: any[], options?: { dbName?: string; clientUrl?: string }) {
  DI.orm = await MikroORM.init<MongoDriver>({
    type: 'mongo',
    entities,
    dbName: options?.dbName ?? process.env.DB_NAME ?? 'linger',
    clientUrl: options?.clientUrl ?? process.env.LINGER_MONGO_URL ?? process.env.DEMO_DATABASE
  } as any)

  DI.em = DI.orm.em as MongoEntityManager
  return DI
}

export async function disconnect() {
  if (DI.orm) await DI.orm.close()
}
