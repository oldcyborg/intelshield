import 'dotenv/config';
import { types } from 'pg';
import { DataSource, DataSourceOptions } from 'typeorm';
import { getEnv } from '../config/env';

// PostgreSQL `date` (OID 1082) stays a plain YYYY-MM-DD string. As a JS Date it
// would shift by the server's UTC offset and a shift on the 13th lands on the 12th.
types.setTypeParser(1082, (value: string) => value);

export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: getEnv('DB_HOST', 'localhost'),
    port: parseInt(getEnv('DB_PORT', '5433'), 10),
    username: getEnv('DB_USERNAME', 'patrol'),
    password: getEnv('DB_PASSWORD', 'patrol'),
    database: getEnv('DB_DATABASE', 'patrol'),
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    synchronize: false,
    logging: false,
  };
}

export default new DataSource(buildDataSourceOptions());
