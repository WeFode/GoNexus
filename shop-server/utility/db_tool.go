package utility

import (
	"database/sql"
	"errors"
)

func IsNoRowsError(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}
