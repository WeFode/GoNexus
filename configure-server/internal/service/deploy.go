package service

import (
	"context"
	"io"

	v1 "configure-server/api/deploy/v1"
)

type DeployRequest struct {
	NodeIds        []string
	ArtifactId     int64
	HostPort       int
	Operator       string
	Remark         string
	Strategy       string
	CanaryCount    int
	CanaryHostPort int
}

type IDeploy interface {
	Heartbeat(ctx context.Context, in *v1.HeartbeatReq) ([]v1.JobItem, error)
	ReportJob(ctx context.Context, id int64, status, message string) error
	ListNodes(ctx context.Context) ([]v1.NodeItem, error)
	ListArtifacts(ctx context.Context, serviceName string) ([]v1.ArtifactItem, error)
	SaveArtifact(ctx context.Context, meta v1.ArtifactItem, r io.Reader) (*v1.ArtifactItem, error)
	CreateDeploy(ctx context.Context, in DeployRequest) ([]int64, error)
	Rollback(ctx context.Context, nodeId, serviceName, operator, remark string) (int64, error)
	Promote(ctx context.Context, artifactId int64, operator, remark string) ([]int64, error)
	CreateLifecycle(ctx context.Context, nodeId, serviceName, action, operator string) (int64, error)
	ListJobs(ctx context.Context, nodeId string) ([]v1.DeployJobItem, error)
	ArtifactFile(ctx context.Context, id int64) (path string, err error)
}

var localDeploy IDeploy

func Deploy() IDeploy {
	if localDeploy == nil {
		panic("implement not found for interface IDeploy, forgot register?")
	}
	return localDeploy
}

func RegisterDeploy(i IDeploy) {
	localDeploy = i
}
