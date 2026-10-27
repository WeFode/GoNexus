export const SERVICE_DEFAULT_YAML = `server:
  address: ":8080"
  openapiPath: "/api.json"
  swaggerPath: "/swagger"

logger:
  level: "all"
  stdout: true
`

export function localConfigYaml(serviceName: string) {
  const name = serviceName.trim() || 'your-service'
  return `# 只留 etcd 入口。server / database / redis 由配置中心下发。
svc:
  etcd:
    host: "127.0.0.1:2379@${name}"
    watch: true
    snapshotDir: "data/config-cache"
`
}

export function goModSnippet() {
  return `require configure-center/pkg/etcdcfg v0.0.0
replace configure-center/pkg/etcdcfg => ../pkg/etcdcfg`
}

export function cmdSnippet() {
  return `if err = etcdcfg.Boot(ctx); err != nil {
    return err
}
s := g.Server()
s.Group("/api/v1", func(group *ghttp.RouterGroup) {
    group.Middleware(ghttp.MiddlewareHandlerResponse)
    etcdcfg.BindHealth(group)
    group.Bind(/* 业务 controller */)
})`
}

export function catalogSnippet(serviceName: string) {
  const name = serviceName.trim() || 'your-service'
  return `{ "name": "${name}", "dockerfile": "${name}/Dockerfile", "containerPort": 8080 }`
}
