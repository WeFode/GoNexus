// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package entity

import (
	"github.com/gogf/gf/v2/os/gtime"
)

// DeployJobs is the golang structure for table DEPLOY_JOBS.
type DeployJobs struct {
	Id            int64       `json:"id"             orm:"ID"             description:""` //
	NodeId        string      `json:"node_id"        orm:"NODE_ID"        description:""` //
	ArtifactId    int64       `json:"artifact_id"    orm:"ARTIFACT_ID"    description:""` //
	ServiceName   string      `json:"service_name"   orm:"SERVICE_NAME"   description:""` //
	Action        string      `json:"action"         orm:"ACTION"         description:""` //
	Status        string      `json:"status"         orm:"STATUS"         description:""` //
	ImageName     string      `json:"image_name"     orm:"IMAGE_NAME"     description:""` //
	HostPort      int         `json:"host_port"      orm:"HOST_PORT"      description:""` //
	DockerNetwork string      `json:"docker_network" orm:"DOCKER_NETWORK" description:""` //
	LoopbackAs    string      `json:"loopback_as"    orm:"LOOPBACK_AS"    description:""` //
	Message       string      `json:"message"        orm:"MESSAGE"        description:""` //
	Operator      string      `json:"operator"       orm:"OPERATOR"       description:""` //
	CreatedAt     *gtime.Time `json:"created_at"     orm:"CREATED_AT"     description:""` //
	UpdatedAt     *gtime.Time `json:"updated_at"     orm:"UPDATED_AT"     description:""` //
}
