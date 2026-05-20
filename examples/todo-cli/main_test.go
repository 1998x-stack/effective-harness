package main

import (
	"bytes"
	"io"
	"os"
	"strings"
	"testing"
)

type testEnv struct {
	t       *testing.T
	tmpDir  string
	origDir string
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "todo-cli-test-*")
	if err != nil {
		t.Fatal(err)
	}
	origDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		os.Chdir(origDir)
		os.RemoveAll(tmpDir)
	})
	return &testEnv{t: t, tmpDir: tmpDir, origDir: origDir}
}

// run runs runCLI with the given args and captures stdout/stderr.
// Each call within the same testEnv shares the same working directory (and thus the same tasks.json).
func (env *testEnv) run(args []string) (stdout, stderr string, exitCode int) {
	env.t.Helper()

	oldStdout := os.Stdout
	rOut, wOut, _ := os.Pipe()
	os.Stdout = wOut

	oldStderr := os.Stderr
	rErr, wErr, _ := os.Pipe()
	os.Stderr = wErr

	exitCode = runCLI(args)

	wOut.Close()
	wErr.Close()
	os.Stdout = oldStdout
	os.Stderr = oldStderr

	var bufOut bytes.Buffer
	io.Copy(&bufOut, rOut)
	var bufErr bytes.Buffer
	io.Copy(&bufErr, rErr)

	return bufOut.String(), bufErr.String(), exitCode
}

func TestRunCLIHelp(t *testing.T) {
	env := newTestEnv(t)
	stdout, stderr, code := env.run([]string{"--help"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if !strings.Contains(stdout+stderr, "Todo CLI") {
		t.Fatal("help output should contain 'Todo CLI'")
	}
}

func TestRunCLIShortHelp(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"-h"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if !strings.Contains(stderr, "Todo CLI") {
		t.Fatal("help output should contain 'Todo CLI'")
	}
}

func TestRunCLIAdd(t *testing.T) {
	env := newTestEnv(t)
	stdout, stderr, code := env.run([]string{"add", "Buy groceries"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d\nstderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, "Added task 1: Buy groceries") {
		t.Fatalf("expected 'Added task 1: Buy groceries', got %q", stdout)
	}
}

func TestRunCLIAddMissingTitle(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"add"})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(stderr, "task title is required") {
		t.Fatalf("expected error about missing title, got %q", stderr)
	}
}

func TestRunCLIListEmpty(t *testing.T) {
	env := newTestEnv(t)
	stdout, stderr, code := env.run([]string{"list"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d\nstderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, "No tasks found.") {
		t.Fatalf("expected 'No tasks found.', got %q", stdout)
	}
}

func TestRunCLIListWithTasks(t *testing.T) {
	env := newTestEnv(t)

	_, _, code := env.run([]string{"add", "Task A"})
	if code != 0 {
		t.Fatalf("add failed: exit code %d", code)
	}

	_, _, code = env.run([]string{"add", "Task B"})
	if code != 0 {
		t.Fatalf("add failed: exit code %d", code)
	}

	stdout, _, code := env.run([]string{"list"})
	if code != 0 {
		t.Fatalf("list failed: exit code %d", code)
	}
	if !strings.Contains(stdout, "Task A") || !strings.Contains(stdout, "Task B") {
		t.Fatalf("expected both tasks in list output, got %q", stdout)
	}
	if !strings.Contains(stdout, "[pending]") {
		t.Fatalf("expected pending status in list output, got %q", stdout)
	}
}

func TestRunCLIComplete(t *testing.T) {
	env := newTestEnv(t)
	env.run([]string{"add", "Do work"})

	stdout, stderr, code := env.run([]string{"complete", "1"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d\nstderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, "Completed task 1") {
		t.Fatalf("expected 'Completed task 1', got %q", stdout)
	}

	stdout, _, _ = env.run([]string{"list"})
	if !strings.Contains(stdout, "[done]") {
		t.Fatalf("expected task to show as done, got %q", stdout)
	}
}

func TestRunCLICompleteMissingID(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"complete"})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(stderr, "task ID is required") {
		t.Fatalf("expected error about missing ID, got %q", stderr)
	}
}

func TestRunCLICompleteInvalidID(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"complete", "abc"})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(stderr, "invalid task ID") {
		t.Fatalf("expected error about invalid ID, got %q", stderr)
	}
}

func TestRunCLICompleteNotFound(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"complete", "999"})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(stderr, "not found") {
		t.Fatalf("expected not found error, got %q", stderr)
	}
}

func TestRunCLIDelete(t *testing.T) {
	env := newTestEnv(t)
	env.run([]string{"add", "Delete me"})
	env.run([]string{"add", "Keep me"})

	stdout, stderr, code := env.run([]string{"delete", "1"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d\nstderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, "Deleted task 1") {
		t.Fatalf("expected 'Deleted task 1', got %q", stdout)
	}

	stdout, _, _ = env.run([]string{"list"})
	if strings.Contains(stdout, "Delete me") {
		t.Fatal("deleted task should not appear in list")
	}
	if !strings.Contains(stdout, "Keep me") {
		t.Fatal("remaining task should appear in list")
	}
}

func TestRunCLIDeleteMissingID(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"delete"})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(stderr, "task ID is required") {
		t.Fatalf("expected error about missing ID, got %q", stderr)
	}
}

func TestRunCLIDeleteInvalidID(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"delete", "xyz"})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(stderr, "invalid task ID") {
		t.Fatalf("expected error about invalid ID, got %q", stderr)
	}
}

func TestRunCLIDeleteNotFound(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"delete", "999"})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(stderr, "not found") {
		t.Fatalf("expected not found error, got %q", stderr)
	}
}

func TestRunCLIUnknownCommand(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"unknown"})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(stderr, "unknown command") {
		t.Fatalf("expected unknown command error, got %q", stderr)
	}
}

func TestRunCLIAddHelp(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"add", "--help"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if !strings.Contains(stderr, "Usage: todo-cli add <title>") {
		t.Fatalf("expected add-specific help, got %q", stderr)
	}
}

func TestRunCLIListHelp(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"list", "-h"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if !strings.Contains(stderr, "Usage: todo-cli list") {
		t.Fatalf("expected list-specific help, got %q", stderr)
	}
}

func TestRunCLICompleteHelp(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"complete", "--help"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if !strings.Contains(stderr, "Usage: todo-cli complete <id>") {
		t.Fatalf("expected complete-specific help, got %q", stderr)
	}
}

func TestRunCLIDeleteHelp(t *testing.T) {
	env := newTestEnv(t)
	_, stderr, code := env.run([]string{"delete", "--help"})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if !strings.Contains(stderr, "Usage: todo-cli delete <id>") {
		t.Fatalf("expected delete-specific help, got %q", stderr)
	}
}
