// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package do

import (
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"
)

// DeployJobs is the golang structure of table DEPLOY_JOBS for DAO operations like Where/Data.
type DeployJobs struct {
	g.Meta        `orm:"table:DEPLOY_JOBS, do:true"`
	Id            interface{} //
	NodeId        interface{} //
	ArtifactId    interface{} //
	ServiceName   interface{} //
	Action        interface{} //
	Status        interface{} //
	ImageName     interface{} //
	HostPort      interface{} //
	DockerNetwork interface{} //
	LoopbackAs    interface{} //
	Message       interface{} //
	Operator      interface{} //
	CreatedAt     *gtime.Time //
	UpdatedAt     *gtime.Time //
}
