package etcdcfg

import "github.com/gogf/gf/v2/frame/g"

// Current 返回已通过 Boot / BootFromLocal 挂上的 Adapter。
// 未接入配置中心时 ok=false，业务仍可走本地文件配置。
func Current() (*Adapter, bool) {
	a, ok := g.Cfg().GetAdapter().(*Adapter)
	return a, ok
}

// Runtime 读取当前热更新状态，不触发重载。
func Runtime() (RuntimeInfo, bool) {
	a, ok := Current()
	if !ok {
		return RuntimeInfo{}, false
	}
	return a.RuntimeInfo(), true
}
