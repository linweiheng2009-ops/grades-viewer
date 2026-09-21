// 双模式 DB 抽象:
// - 生产 (CF Pages): 通过 cloudflare:workers env.DB (D1 binding) 提供 D1Database
// - 本地开发: 用 wrangler dev 跑时同样注入; 或 npm run dev:local 走 better-sqlite3
// 仓库层(repo.ts)统一只调 sql() 接口,屏蔽差异
// D1 的 db.exec() 只支持单条 SQL,多 CREATE 必须拆开

export interface DB {
  prepare(sql: string): D1Prepared;
  exec(sql: string): Promise<void> | void;
  batch?(stmts: D1Prepared[]): Promise<any>;
}
export interface D1Prepared {
  bind(...args: any[]): D1Prepared;
  all<T = any>(): Promise<{ results: T[] }>;
  first<T = any>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: any }>;
}

// D1 binding (CF Pages / wrangler dev)
export function fromD1(d1: any): DB {
  return d1 as DB;
}

// better-sqlite3 兼容层 (本地直跑 node server,或测试用)
export function fromSqlite(sqlite: any): DB {
  return {
    prepare: (sql: string) => {
      const stmt = sqlite.prepare(sql);
      const bound: any = {
        bind: (...args: any[]) => {
          bound._args = args;
          return bound;
        },
        all: async () => ({ results: stmt.all(...(bound._args ?? [])) }),
        first: async () => stmt.get(...(bound._args ?? [])) ?? null,
        run: async () => {
          const r = stmt.run(...(bound._args ?? []));
          return { success: true, meta: r };
        },
      };
      return bound;
    },
    exec: (sql: string) => {
      sqlite.exec(sql);
    },
    batch: async (stmts: D1Prepared[]) => {
      for (const s of stmts) await s.run();
    },
  };
}
