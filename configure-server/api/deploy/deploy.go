package deploy

import (
	"context"

	v1 "configure-server/api/deploy/v1"
)

type IDeployV1 interface {
	Heartbeat(ctx context.Context, req *v1.HeartbeatReq) (res *v1.HeartbeatRes, err error)
	ReportJob(ctx context.Context, req *v1.ReportJobReq) (res *v1.ReportJobRes, err error)
	ListNodes(ctx context.Context, req *v1.ListNodesReq) (res *v1.ListNodesRes, err error)
	ListArtifacts(ctx context.Context, req *v1.ListArtifactsReq) (res *v1.ListArtifactsRes, err error)
	UploadArtifact(ctx context.Context, req *v1.UploadArtifactReq) (res *v1.UploadArtifactRes, err error)
	CreateDeploy(ctx context.Context, req *v1.CreateDeployReq) (res *v1.CreateDeployRes, err error)
	RollbackDeploy(ctx context.Context, req *v1.RollbackDeployReq) (res *v1.RollbackDeployRes, err error)
	PromoteDeploy(ctx context.Context, req *v1.PromoteDeployReq) (res *v1.PromoteDeployRes, err error)
	Lifecycle(ctx context.Context, req *v1.LifecycleReq) (res *v1.LifecycleRes, err error)
	ListJobs(ctx context.Context, req *v1.ListJobsReq) (res *v1.ListJobsRes, err error)
}
