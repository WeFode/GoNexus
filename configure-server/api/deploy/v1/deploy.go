package v1

import "github.com/gogf/gf/v2/frame/g"

type ContainerInfo struct {
	Name   string `json:"name"`
	Image  string `json:"image"`
	Status string `json:"status"`
	Ports  string `json:"ports"`
}

type HeartbeatReq struct {
	g.Meta         `path:"/agent/heartbeat" method:"post" tags:"Agent" summary:"节点心跳"`
	NodeId         string          `json:"nodeId" v:"required"`
	Hostname       string          `json:"hostname"`
	OS             string          `json:"os"`
	Arch           string          `json:"arch"`
	DockerPlatform string          `json:"dockerPlatform"`
	DockerNetwork  string          `json:"dockerNetwork"`
	LoopbackAs     string          `json:"loopbackAs"`
	Ncpu           int             `json:"ncpu"`
	MemoryBytes    int64           `json:"memoryBytes"`
	AgentVersion   string          `json:"agentVersion"`
	Containers     []ContainerInfo `json:"containers"`
}

type HeartbeatRes struct {
	Jobs []JobItem `json:"jobs"`
}

type JobItem struct {
	Id            int64  `json:"id"`
	Action        string `json:"action"`
	ServiceName   string `json:"serviceName"`
	ImageName     string `json:"imageName"`
	ArtifactId    int64  `json:"artifactId"`
	ContainerName string `json:"containerName"`
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	DockerNetwork string `json:"dockerNetwork"`
	LoopbackAs    string `json:"loopbackAs"`
	EtcdHost      string `json:"etcdHost"`
}

type ReportJobReq struct {
	g.Meta  `path:"/agent/jobs/{id}/report" method:"post" tags:"Agent" summary:"回写任务结果"`
	Id      int64  `path:"id" v:"required"`
	Status  string `json:"status" v:"required|in:running,success,failed"`
	Message string `json:"message"`
}

type ReportJobRes struct{}

type ListNodesReq struct {
	g.Meta `path:"/nodes" method:"get" tags:"Deploy" summary:"节点列表"`
}

type NodeItem struct {
	NodeId         string          `json:"nodeId"`
	Hostname       string          `json:"hostname"`
	OS             string          `json:"os"`
	Arch           string          `json:"arch"`
	DockerPlatform string          `json:"dockerPlatform"`
	DockerNetwork  string          `json:"dockerNetwork"`
	LoopbackAs     string          `json:"loopbackAs"`
	Ncpu           int             `json:"ncpu"`
	MemoryBytes    int64           `json:"memoryBytes"`
	AgentVersion   string          `json:"agentVersion"`
	Online         bool            `json:"online"`
	LastSeen       string          `json:"lastSeen"`
	Containers     []ContainerInfo `json:"containers"`
}

type ListNodesRes struct {
	List []NodeItem `json:"list"`
}

type ArtifactItem struct {
	Id            int64  `json:"id"`
	ServiceName   string `json:"serviceName"`
	ImageName     string `json:"imageName"`
	Platform      string `json:"platform"`
	ContainerPort int    `json:"containerPort"`
	FileSize      int64  `json:"fileSize"`
	Sha256        string `json:"sha256"`
	Operator      string `json:"operator"`
	CreatedAt     string `json:"createdAt"`
}

type ListArtifactsReq struct {
	g.Meta      `path:"/artifacts" method:"get" tags:"Deploy" summary:"产物列表"`
	ServiceName string `query:"serviceName"`
}

type ListArtifactsRes struct {
	List []ArtifactItem `json:"list"`
}

type UploadArtifactReq struct {
	g.Meta        `path:"/artifacts" method:"post" mime:"multipart/form-data" tags:"Deploy" summary:"上传 tar 产物"`
	ServiceName   string `p:"serviceName" v:"required"`
	ImageName     string `p:"imageName" v:"required"`
	Platform      string `p:"platform" v:"required"`
	ContainerPort int    `p:"containerPort"`
}

type UploadArtifactRes struct {
	ArtifactItem
}

type CreateDeployReq struct {
	g.Meta      `path:"/deploys" method:"post" tags:"Deploy" summary:"发布到指定节点（选一个节点即灰度）"`
	NodeIds     []string `json:"nodeIds" v:"required"`
	ArtifactId  int64    `json:"artifactId" v:"required"`
	HostPort    int      `json:"hostPort" dc:"宿主机端口，默认等于容器端口"`
	Remark      string   `json:"remark"`
}

type CreateDeployRes struct {
	JobIds []int64 `json:"jobIds"`
}

type RollbackDeployReq struct {
	g.Meta      `path:"/deploys/rollback" method:"post" tags:"Deploy" summary:"回滚到该节点该服务上一成功版本"`
	NodeId      string `json:"nodeId" v:"required"`
	ServiceName string `json:"serviceName" v:"required"`
	Remark      string `json:"remark"`
}

type RollbackDeployRes struct {
	JobId int64 `json:"jobId"`
}

type ListJobsReq struct {
	g.Meta `path:"/deploys" method:"get" tags:"Deploy" summary:"发布任务"`
	NodeId string `query:"nodeId"`
}

type DeployJobItem struct {
	Id          int64  `json:"id"`
	NodeId      string `json:"nodeId"`
	ArtifactId  int64  `json:"artifactId"`
	ServiceName string `json:"serviceName"`
	Action      string `json:"action"`
	Status      string `json:"status"`
	ImageName   string `json:"imageName"`
	HostPort    int    `json:"hostPort"`
	Message     string `json:"message"`
	Operator    string `json:"operator"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type ListJobsRes struct {
	List []DeployJobItem `json:"list"`
}
