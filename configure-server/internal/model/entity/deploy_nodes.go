// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package entity

import (
	"github.com/gogf/gf/v2/os/gtime"
)

// DeployNodes is the golang structure for table DEPLOY_NODES.
type DeployNodes struct {
	NodeId         string      `json:"node_id"         orm:"NODE_ID"         description:""` //
	Hostname       string      `json:"hostname"        orm:"HOSTNAME"        description:""` //
	Os             string      `json:"os"              orm:"OS"              description:""` //
	Arch           string      `json:"arch"            orm:"ARCH"            description:""` //
	DockerPlatform string      `json:"docker_platform" orm:"DOCKER_PLATFORM" description:""` //
	DockerNetwork  string      `json:"docker_network"  orm:"DOCKER_NETWORK"  description:""` //
	LoopbackAs     string      `json:"loopback_as"     orm:"LOOPBACK_AS"     description:""` //
	Ncpu           int         `json:"ncpu"            orm:"NCPU"            description:""` //
	MemoryBytes    int64       `json:"memory_bytes"    orm:"MEMORY_BYTES"    description:""` //
	AgentVersion   string      `json:"agent_version"   orm:"AGENT_VERSION"   description:""` //
	Containers     string      `json:"containers"      orm:"CONTAINERS"      description:""` //
	LastSeen       *gtime.Time `json:"last_seen"       orm:"LAST_SEEN"       description:""` //
}
