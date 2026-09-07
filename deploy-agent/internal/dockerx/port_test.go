package dockerx

import "testing"

func TestParseListeningPIDs(t *testing.T) {
	t.Parallel()
	out := `
  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       18800
  TCP    [::]:8000              [::]:0                 LISTENING       18800
  TCP    0.0.0.0:18000          0.0.0.0:0              LISTENING       99
  TCP    127.0.0.1:8000         127.0.0.1:51234        ESTABLISHED     7
`
	got := parseListeningPIDs(out, 8000)
	if len(got) != 1 || got[0] != "18800" {
		t.Fatalf("got %v", got)
	}
	if len(parseListeningPIDs(out, 18000)) != 1 {
		t.Fatal("18000")
	}
	if len(parseListeningPIDs(out, 9000)) != 0 {
		t.Fatal("9000")
	}
}

func TestIsBindError(t *testing.T) {
	t.Parallel()
	err := fmtError("exit status 1: Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:8000 -> 127.0.0.1:0: listen tcp 0.0.0.0:8000: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.")
	if !isBindError(err) {
		t.Fatal("should detect")
	}
	if isBindError(fmtError("no such container")) {
		t.Fatal("should not")
	}
	if localPort("0.0.0.0:8000") != "8000" || localPort("[::]:8000") != "8000" {
		t.Fatal(localPort("0.0.0.0:8000"), localPort("[::]:8000"))
	}
}

type fmtError string

func (e fmtError) Error() string { return string(e) }
