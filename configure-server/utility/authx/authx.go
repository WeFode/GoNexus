package authx

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"configure-server/internal/consts"
)

type Principal struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

type Claims struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

type account struct {
	Username string
	Hash     []byte
	Role     string
}

var (
	once     sync.Once
	initErr  error
	secret   []byte
	expire   time.Duration
	accounts []account
)

type userCfg struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func Init(ctx context.Context) error {
	once.Do(func() {
		initErr = load(ctx)
	})
	return initErr
}

func load(ctx context.Context) error {
	s := strings.TrimSpace(g.Cfg().MustGet(ctx, "auth.jwtSecret").String())
	if s == "" {
		return gerror.New("本地配置缺少 auth.jwtSecret")
	}
	secret = []byte(s)

	expire = g.Cfg().MustGet(ctx, "auth.expire", "24h").Duration()
	if expire <= 0 {
		expire = 24 * time.Hour
	}

	var users []userCfg
	if err := g.Cfg().MustGet(ctx, "auth.users").Scan(&users); err != nil {
		return gerror.Wrap(err, "读取 auth.users 失败")
	}
	if len(users) == 0 {
		return gerror.New("本地配置缺少 auth.users，至少需要一个账户")
	}

	seen := map[string]struct{}{}
	for _, u := range users {
		name := strings.TrimSpace(u.Username)
		pass := u.Password
		role := strings.TrimSpace(u.Role)
		if name == "" || pass == "" {
			return gerror.New("auth.users 的 username / password 不能为空")
		}
		if role != consts.RoleAdmin && role != consts.RoleOperator {
			return gerror.Newf("账户 %s 的 role 只能是 admin 或 operator", name)
		}
		if _, ok := seen[name]; ok {
			return gerror.Newf("重复账户: %s", name)
		}
		seen[name] = struct{}{}
		hash, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		accounts = append(accounts, account{Username: name, Hash: hash, Role: role})
	}
	g.Log().Infof(ctx, "已加载 %d 个登录账户", len(accounts))
	return nil
}

func Login(_ context.Context, username, password string) (token string, expireAt time.Time, p Principal, err error) {
	username = strings.TrimSpace(username)
	var acc *account
	for i := range accounts {
		if accounts[i].Username == username {
			acc = &accounts[i]
			break
		}
	}
	if acc == nil || bcrypt.CompareHashAndPassword(acc.Hash, []byte(password)) != nil {
		return "", time.Time{}, Principal{}, gerror.New("用户名或密码错误")
	}

	now := time.Now()
	exp := now.Add(expire)
	claims := Claims{
		Username: acc.Username,
		Role:     acc.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   acc.Username,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
	if err != nil {
		return "", time.Time{}, Principal{}, err
	}
	return signed, exp, Principal{Username: acc.Username, Role: acc.Role}, nil
}

func Parse(token string) (*Claims, error) {
	token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	if token == "" {
		return nil, gerror.New("未登录")
	}
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, gerror.New("非法 token")
		}
		return secret, nil
	})
	if err != nil || parsed == nil || !parsed.Valid {
		return nil, gerror.New("未登录或登录已过期")
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok {
		return nil, gerror.New("未登录或登录已过期")
	}
	return claims, nil
}
