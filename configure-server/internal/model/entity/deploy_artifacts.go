// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package entity

import (
	"github.com/gogf/gf/v2/os/gtime"
)

// DeployArtifacts is the golang structure for table DEPLOY_ARTIFACTS.
type DeployArtifacts struct {
	Id            int64       `json:"id"             orm:"ID"             description:""` //
	ServiceName   string      `json:"service_name"   orm:"SERVICE_NAME"   description:""` //
	ImageName     string      `json:"image_name"     orm:"IMAGE_NAME"     description:""` //
	Platform      string      `json:"platform"       orm:"PLATFORM"       description:""` //
	ContainerPort int         `json:"container_port" orm:"CONTAINER_PORT" description:""` //
	FilePath      string      `json:"file_path"      orm:"FILE_PATH"      description:""` //
	FileSize      int64       `json:"file_size"      orm:"FILE_SIZE"      description:""` //
	Sha256        string      `json:"sha_256"        orm:"SHA256"         description:""` //
	Operator      string      `json:"operator"       orm:"OPERATOR"       description:""` //
	CreatedAt     *gtime.Time `json:"created_at"     orm:"CREATED_AT"     description:""` //
}
