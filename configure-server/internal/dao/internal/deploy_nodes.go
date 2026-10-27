// ==========================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// ==========================================================================

package internal

import (
	"context"

	"github.com/gogf/gf/v2/database/gdb"
	"github.com/gogf/gf/v2/frame/g"
)

// DeployNodesDao is the data access object for the table DEPLOY_NODES.
type DeployNodesDao struct {
	table    string             // table is the underlying table name of the DAO.
	group    string             // group is the database configuration group name of the current DAO.
	columns  DeployNodesColumns // columns contains all the column names of Table for convenient usage.
	handlers []gdb.ModelHandler // handlers for customized model modification.
}

// DeployNodesColumns defines and stores column names for the table DEPLOY_NODES.
type DeployNodesColumns struct {
	NodeId         string //
	Hostname       string //
	Os             string //
	Arch           string //
	DockerPlatform string //
	DockerNetwork  string //
	LoopbackAs     string //
	Ncpu           string //
	MemoryBytes    string //
	AgentVersion   string //
	Containers     string //
	LastSeen       string //
}

// deployNodesColumns holds the columns for the table DEPLOY_NODES.
var deployNodesColumns = DeployNodesColumns{
	NodeId:         "NODE_ID",
	Hostname:       "HOSTNAME",
	Os:             "OS",
	Arch:           "ARCH",
	DockerPlatform: "DOCKER_PLATFORM",
	DockerNetwork:  "DOCKER_NETWORK",
	LoopbackAs:     "LOOPBACK_AS",
	Ncpu:           "NCPU",
	MemoryBytes:    "MEMORY_BYTES",
	AgentVersion:   "AGENT_VERSION",
	Containers:     "CONTAINERS",
	LastSeen:       "LAST_SEEN",
}

// NewDeployNodesDao creates and returns a new DAO object for table data access.
func NewDeployNodesDao(handlers ...gdb.ModelHandler) *DeployNodesDao {
	return &DeployNodesDao{
		group:    "default",
		table:    "DEPLOY_NODES",
		columns:  deployNodesColumns,
		handlers: handlers,
	}
}

// DB retrieves and returns the underlying raw database management object of the current DAO.
func (dao *DeployNodesDao) DB() gdb.DB {
	return g.DB(dao.group)
}

// Table returns the table name of the current DAO.
func (dao *DeployNodesDao) Table() string {
	return dao.table
}

// Columns returns all column names of the current DAO.
func (dao *DeployNodesDao) Columns() DeployNodesColumns {
	return dao.columns
}

// Group returns the database configuration group name of the current DAO.
func (dao *DeployNodesDao) Group() string {
	return dao.group
}

// Ctx creates and returns a Model for the current DAO. It automatically sets the context for the current operation.
func (dao *DeployNodesDao) Ctx(ctx context.Context) *gdb.Model {
	model := dao.DB().Model(dao.table)
	for _, handler := range dao.handlers {
		model = handler(model)
	}
	return model.Safe().Ctx(ctx)
}

// Transaction wraps the transaction logic using function f.
// It rolls back the transaction and returns the error if function f returns a non-nil error.
// It commits the transaction and returns nil if function f returns nil.
//
// Note: Do not commit or roll back the transaction in function f,
// as it is automatically handled by this function.
func (dao *DeployNodesDao) Transaction(ctx context.Context, f func(ctx context.Context, tx gdb.TX) error) (err error) {
	return dao.Ctx(ctx).Transaction(ctx, f)
}
