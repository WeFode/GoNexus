// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package do

import (
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"
)

// DeployNodes is the golang structure of table DEPLOY_NODES for DAO operations like Where/Data.
type DeployNodes struct {
	g.Meta         `orm:"table:DEPLOY_NODES, do:true"`
	NodeId         interface{} //
	Hostname       interface{} //
	Os             interface{} //
	Arch           interface{} //
	DockerPlatform interface{} //
	DockerNetwork  interface{} //
	LoopbackAs     interface{} //
	Ncpu           interface{} //
	MemoryBytes    interface{} //
	AgentVersion   interface{} //
	Containers     interface{} //
	LastSeen       *gtime.Time //
}
