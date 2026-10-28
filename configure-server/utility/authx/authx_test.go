package authx

import (
	"testing"
	"time"
)

func resetFails() {
	loginMu.Lock()
	fails = map[string]*attempt{}
	lastPrune = time.Time{}
	loginMu.Unlock()
}

func TestLockoutAfterMaxFails(t *testing.T) {
	resetFails()
	defer resetFails()
	for i := 0; i < maxLoginFails; i++ {
		recordFail("alice")
	}
	if err := checkLockout("alice"); err == nil {
		t.Fatal("expected lockout after max fails")
	}
}

func TestLockoutExpiryResetsCounter(t *testing.T) {
	resetFails()
	defer resetFails()
	for i := 0; i < maxLoginFails; i++ {
		recordFail("bob")
	}
	loginMu.Lock()
	fails["bob"].until = time.Now().Add(-time.Second)
	loginMu.Unlock()
	if err := checkLockout("bob"); err != nil {
		t.Fatalf("lockout should have expired: %v", err)
	}
	recordFail("bob")
	loginMu.Lock()
	got := fails["bob"].fails
	loginMu.Unlock()
	if got != 1 {
		t.Fatalf("fails = %d, want 1 after lockout expiry", got)
	}
}

func TestPruneFails(t *testing.T) {
	resetFails()
	defer resetFails()
	now := time.Now()
	loginMu.Lock()
	fails["old"] = &attempt{fails: 2, last: now.Add(-failWindow - time.Minute)}
	fails["locked"] = &attempt{fails: maxLoginFails, last: now, until: now.Add(lockDuration)}
	fails["active"] = &attempt{fails: 1, last: now}
	pruneFails(now)
	_, oldExists := fails["old"]
	_, lockedExists := fails["locked"]
	_, activeExists := fails["active"]
	loginMu.Unlock()
	if oldExists {
		t.Error("expired entry should be pruned")
	}
	if !lockedExists {
		t.Error("locked entry should be kept")
	}
	if !activeExists {
		t.Error("active entry should be kept")
	}
}
