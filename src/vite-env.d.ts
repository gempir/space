interface ImportMetaEnv {
  readonly VITE_SPACETIMEDB_HOST: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css" {
  const content: string;
  export default content;
}
