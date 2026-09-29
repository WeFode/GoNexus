package deploy

import (
	"context"
	"os"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"

	v1 "configure-server/api/deploy/v1"
	"configure-server/internal/consts"
	"configure-server/internal/service"
)

type ControllerV1 struct{}

func NewV1() *ControllerV1 {
	return &ControllerV1{}
}

func operator(ctx context.Context) string {
	u := g.RequestFromCtx(ctx).GetCtxVar(consts.CtxUsername).String()
	if u == "" {
		return "anonymous"
	}
	return u
}

func (c *ControllerV1) Heartbeat(ctx context.Context, req *v1.HeartbeatReq) (*v1.HeartbeatRes, error) {
	jobs, err := service.Deploy().Heartbeat(ctx, req)
	if err != nil {
		return nil, err
	}
	return &v1.HeartbeatRes{Jobs: jobs}, nil
}

func (c *ControllerV1) ReportJob(ctx context.Context, req *v1.ReportJobReq) (*v1.ReportJobRes, error) {
	return &v1.ReportJobRes{}, service.Deploy().ReportJob(ctx, req.Id, req.Status, req.Message)
}

func (c *ControllerV1) ListNodes(ctx context.Context, _ *v1.ListNodesReq) (*v1.ListNodesRes, error) {
	list, err := service.Deploy().ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	return &v1.ListNodesRes{List: list}, nil
}

func (c *ControllerV1) Recommend(ctx context.Context, req *v1.RecommendReq) (*v1.RecommendRes, error) {
	return service.Deploy().Recommend(ctx, req.ArtifactId, req.HostPort)
}

func (c *ControllerV1) ListArtifacts(ctx context.Context, req *v1.ListArtifactsReq) (*v1.ListArtifactsRes, error) {
	list, err := service.Deploy().ListArtifacts(ctx, req.ServiceName)
	if err != nil {
		return nil, err
	}
	return &v1.ListArtifactsRes{List: list}, nil
}

func (c *ControllerV1) UploadArtifact(ctx context.Context, req *v1.UploadArtifactReq) (*v1.UploadArtifactRes, error) {
	r := g.RequestFromCtx(ctx)
	file := r.GetUploadFile("file")
	if file == nil {
		return nil, gerror.New("请上传 tar 文件（字段名 file）")
	}
	f, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	port := req.ContainerPort
	if port <= 0 {
		port = 8000
	}
	item, err := service.Deploy().SaveArtifact(ctx, v1.ArtifactItem{
		ServiceName:   req.ServiceName,
		ImageName:     req.ImageName,
		Platform:      req.Platform,
		ContainerPort: port,
		Operator:      operator(ctx),
	}, f)
	if err != nil {
		return nil, err
	}
	return &v1.UploadArtifactRes{ArtifactItem: *item}, nil
}

func (c *ControllerV1) CreateDeploy(ctx context.Context, req *v1.CreateDeployReq) (*v1.CreateDeployRes, error) {
	ids, err := service.Deploy().CreateDeploy(ctx, service.DeployRequest{
		NodeIds:        req.NodeIds,
		ArtifactId:     req.ArtifactId,
		HostPort:       req.HostPort,
		Operator:       operator(ctx),
		Remark:         req.Remark,
		Strategy:       req.Strategy,
		CanaryCount:    req.CanaryCount,
		CanaryHostPort: req.CanaryHostPort,
	})
	if err != nil {
		return nil, err
	}
	return &v1.CreateDeployRes{JobIds: ids}, nil
}

func (c *ControllerV1) RollbackDeploy(ctx context.Context, req *v1.RollbackDeployReq) (*v1.RollbackDeployRes, error) {
	id, err := service.Deploy().Rollback(ctx, req.NodeId, req.ServiceName, operator(ctx), req.Remark)
	if err != nil {
		return nil, err
	}
	return &v1.RollbackDeployRes{JobId: id}, nil
}

func (c *ControllerV1) PromoteDeploy(ctx context.Context, req *v1.PromoteDeployReq) (*v1.PromoteDeployRes, error) {
	ids, err := service.Deploy().Promote(ctx, req.ArtifactId, operator(ctx), req.Remark)
	if err != nil {
		return nil, err
	}
	return &v1.PromoteDeployRes{JobIds: ids}, nil
}

func (c *ControllerV1) Lifecycle(ctx context.Context, req *v1.LifecycleReq) (*v1.LifecycleRes, error) {
	id, err := service.Deploy().CreateLifecycle(ctx, req.NodeId, req.ServiceName, req.Action, operator(ctx))
	if err != nil {
		return nil, err
	}
	return &v1.LifecycleRes{JobId: id}, nil
}

func (c *ControllerV1) ListJobs(ctx context.Context, req *v1.ListJobsReq) (*v1.ListJobsRes, error) {
	list, err := service.Deploy().ListJobs(ctx, req.NodeId)
	if err != nil {
		return nil, err
	}
	return &v1.ListJobsRes{List: list}, nil
}

func DownloadArtifact(r *ghttp.Request) {
	id := r.Get("id").Int64()
	path, err := service.Deploy().ArtifactFile(r.Context(), id)
	if err != nil {
		r.Response.WriteStatusExit(404, err.Error())
		return
	}
	if _, err = os.Stat(path); err != nil {
		r.Response.WriteStatusExit(404, "产物文件不存在")
		return
	}
	r.Response.ServeFileDownload(path)
}
