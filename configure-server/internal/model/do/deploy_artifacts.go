// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package do

import (
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"
)

// DeployArtifacts is the golang structure of table DEPLOY_ARTIFACTS for DAO operations like Where/Data.
type DeployArtifacts struct {
	g.Meta        `orm:"table:DEPLOY_ARTIFACTS, do:true"`
	Id            interface{} //
	ServiceName   interface{} //
	ImageName     interface{} //
	Platform      interface{} //
	ContainerPort interface{} //
	FilePath      interface{} //
	FileSize      interface{} //
	Sha256        interface{} //
	Operator      interface{} //
	CreatedAt     *gtime.Time //
}
