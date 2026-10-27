package config

import (
	"context"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"

	v1 "configure-server/api/config/v1"
	"configure-server/internal/consts"
	"configure-server/internal/service"
)

type ControllerV1 struct{}

func NewV1() *ControllerV1 {
	return &ControllerV1{}
}

func audit(ctx context.Context, remark string) service.Audit {
	username := g.RequestFromCtx(ctx).GetCtxVar(consts.CtxUsername).String()
	if username == "" {
		username = "anonymous"
	}
	return service.Audit{Operator: username, Remark: remark}
}

func (c *ControllerV1) ListShared(ctx context.Context, _ *v1.ListSharedReq) (*v1.ListSharedRes, error) {
	list, err := service.Config().ListShared(ctx)
	if err != nil {
		return nil, err
	}
	return &v1.ListSharedRes{List: list}, nil
}

func (c *ControllerV1) GetShared(ctx context.Context, req *v1.GetSharedReq) (*v1.GetSharedRes, error) {
	item, err := service.Config().GetShared(ctx, req.Key)
	if err != nil {
		return nil, err
	}
	return &v1.GetSharedRes{ConfigItem: *item}, nil
}

func (c *ControllerV1) PutShared(ctx context.Context, req *v1.PutSharedReq) (*v1.PutSharedRes, error) {
	return &v1.PutSharedRes{}, service.Config().PutShared(ctx, req.Key, req.Content, audit(ctx, req.Remark))
}

func (c *ControllerV1) DeleteShared(ctx context.Context, req *v1.DeleteSharedReq) (*v1.DeleteSharedRes, error) {
	return &v1.DeleteSharedRes{}, service.Config().DeleteShared(ctx, req.Key, audit(ctx, req.Remark))
}

func (c *ControllerV1) ListServices(ctx context.Context, _ *v1.ListServicesReq) (*v1.ListServicesRes, error) {
	list, err := service.Config().ListServices(ctx)
	if err != nil {
		return nil, err
	}
	return &v1.ListServicesRes{List: list}, nil
}

func (c *ControllerV1) GetService(ctx context.Context, req *v1.GetServiceReq) (*v1.GetServiceRes, error) {
	item, err := service.Config().GetService(ctx, req.Name)
	if err != nil {
		return nil, err
	}
	return &v1.GetServiceRes{ConfigItem: *item}, nil
}

func (c *ControllerV1) PutService(ctx context.Context, req *v1.PutServiceReq) (*v1.PutServiceRes, error) {
	return &v1.PutServiceRes{}, service.Config().PutService(ctx, req.Name, req.Content, audit(ctx, req.Remark))
}

func (c *ControllerV1) DeleteService(ctx context.Context, req *v1.DeleteServiceReq) (*v1.DeleteServiceRes, error) {
	return &v1.DeleteServiceRes{}, service.Config().DeleteService(ctx, req.Name, audit(ctx, req.Remark))
}

func (c *ControllerV1) Preview(ctx context.Context, req *v1.PreviewReq) (*v1.PreviewRes, error) {
	content, err := service.Config().Preview(ctx, req.Name)
	if err != nil {
		return nil, err
	}
	return &v1.PreviewRes{Name: req.Name, Content: content}, nil
}

func (c *ControllerV1) Seed(ctx context.Context, req *v1.SeedReq) (*v1.SeedRes, error) {
	if req.Force && g.RequestFromCtx(ctx).GetCtxVar(consts.CtxRole).String() != consts.RoleAdmin {
		return nil, gerror.New("仅管理员可强制覆盖 seed")
	}
	n, err := service.Config().Seed(ctx, req.Dir, req.Force, audit(ctx, req.Remark))
	if err != nil {
		return nil, err
	}
	return &v1.SeedRes{Written: n}, nil
}

func (c *ControllerV1) ListHistory(ctx context.Context, req *v1.ListHistoryReq) (*v1.ListHistoryRes, error) {
	list, err := service.Config().ListHistory(ctx, req.Kind, req.Key)
	if err != nil {
		return nil, err
	}
	return &v1.ListHistoryRes{List: list}, nil
}

func (c *ControllerV1) Rollback(ctx context.Context, req *v1.RollbackReq) (*v1.RollbackRes, error) {
	ver, err := service.Config().Rollback(ctx, req.Kind, req.Key, req.Version, audit(ctx, req.Remark))
	if err != nil {
		return nil, err
	}
	return &v1.RollbackRes{Version: ver}, nil
}
