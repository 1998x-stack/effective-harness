package store

import (
	"os"
	"testing"
)

func TestNew(t *testing.T) {
	s := New()
	if s == nil {
		t.Fatal("New() returned nil")
	}
	tasks := s.GetAll()
	if len(tasks) != 0 {
		t.Fatal("new store should have no tasks")
	}
}

func TestAdd(t *testing.T) {
	s := New()
	task := s.Add("Buy groceries")
	if task.ID != 1 {
		t.Fatalf("expected ID 1, got %d", task.ID)
	}
	if task.Title != "Buy groceries" {
		t.Fatalf("expected title 'Buy groceries', got %q", task.Title)
	}
	if task.Completed {
		t.Fatal("new task should not be completed")
	}

	tasks := s.GetAll()
	if len(tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(tasks))
	}
}

func TestAddMultiple(t *testing.T) {
	s := New()
	s.Add("First")
	s.Add("Second")
	s.Add("Third")

	tasks := s.GetAll()
	if len(tasks) != 3 {
		t.Fatalf("expected 3 tasks, got %d", len(tasks))
	}
	if tasks[0].ID != 1 || tasks[1].ID != 2 || tasks[2].ID != 3 {
		t.Fatal("task IDs should be sequential 1, 2, 3")
	}
}

func TestGetAllEmpty(t *testing.T) {
	s := New()
	tasks := s.GetAll()
	if len(tasks) != 0 {
		t.Fatal("expected empty task list")
	}
}

func TestGetAllReturnsCopy(t *testing.T) {
	s := New()
	s.Add("Task")
	tasks := s.GetAll()
	// Modify the returned slice
	tasks[0].Title = "Modified"
	// Original should be unchanged
	original := s.GetAll()
	if original[0].Title != "Task" {
		t.Fatal("GetAll should return a copy, not the original slice")
	}
}

func TestComplete(t *testing.T) {
	s := New()
	task := s.Add("Test task")

	if task.Completed {
		t.Fatal("new task should not be completed")
	}

	err := s.Complete(task.ID)
	if err != nil {
		t.Fatalf("Complete() returned error: %v", err)
	}

	tasks := s.GetAll()
	if len(tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(tasks))
	}
	if !tasks[0].Completed {
		t.Fatal("task should be marked completed")
	}
}

func TestCompleteNotFound(t *testing.T) {
	s := New()
	err := s.Complete(999)
	if err == nil {
		t.Fatal("expected error for non-existent task ID")
	}
}

func TestDelete(t *testing.T) {
	s := New()
	t1 := s.Add("Task 1")
	t2 := s.Add("Task 2")
	t3 := s.Add("Task 3")

	err := s.Delete(t2.ID)
	if err != nil {
		t.Fatalf("Delete() returned error: %v", err)
	}

	tasks := s.GetAll()
	if len(tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(tasks))
	}
	if tasks[0].ID != t1.ID || tasks[1].ID != t3.ID {
		t.Fatal("remaining tasks should be task 1 and task 3 in order")
	}
}

func TestDeleteNotFound(t *testing.T) {
	s := New()
	err := s.Delete(999)
	if err == nil {
		t.Fatal("expected error for non-existent task ID")
	}
}

func TestDeleteOnlyTask(t *testing.T) {
	s := New()
	s.Add("Only task")

	err := s.Delete(1)
	if err != nil {
		t.Fatalf("Delete() returned error: %v", err)
	}

	tasks := s.GetAll()
	if len(tasks) != 0 {
		t.Fatalf("expected 0 tasks, got %d", len(tasks))
	}
}

func TestNewWithPathLoadsExistingFile(t *testing.T) {
	// Create a temp file with known data
	tmpFile, err := os.CreateTemp("", "todo-test-*.json")
	if err != nil {
		t.Fatal(err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	content := `{"tasks":[{"id":1,"title":"Saved task","completed":true}],"nextID":2}`
	if err := os.WriteFile(tmpPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	tmpFile.Close()

	s := NewWithPath(tmpPath)
	tasks := s.GetAll()
	if len(tasks) != 1 {
		t.Fatalf("expected 1 task loaded from file, got %d", len(tasks))
	}
	if tasks[0].Title != "Saved task" {
		t.Fatalf("expected title 'Saved task', got %q", tasks[0].Title)
	}
	if !tasks[0].Completed {
		t.Fatal("loaded task should be completed")
	}
}

func TestPersistenceRoundTrip(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "todo-test-*.json")
	if err != nil {
		t.Fatal(err)
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	// Create store, add task, persist
	s := NewWithPath(tmpPath)
	task := s.Add("Persistent task")
	s.Complete(task.ID)

	// Create new store from same file - should load persisted data
	s2 := NewWithPath(tmpPath)
	tasks := s2.GetAll()
	if len(tasks) != 1 {
		t.Fatalf("expected 1 task after reload, got %d", len(tasks))
	}
	if tasks[0].Title != "Persistent task" {
		t.Fatalf("expected title 'Persistent task', got %q", tasks[0].Title)
	}
	if !tasks[0].Completed {
		t.Fatal("task should be completed after reload")
	}
}

func TestPersistenceDeleteReflectsInFile(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "todo-test-*.json")
	if err != nil {
		t.Fatal(err)
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	s := NewWithPath(tmpPath)
	t1 := s.Add("Task 1")
	s.Add("Task 2")
	s.Delete(t1.ID)

	// Reload from file - deleted task should not be present
	s2 := NewWithPath(tmpPath)
	tasks := s2.GetAll()
	if len(tasks) != 1 {
		t.Fatalf("expected 1 task after delete+reload, got %d", len(tasks))
	}
	if tasks[0].Title != "Task 2" {
		t.Fatalf("expected remaining task to be 'Task 2', got %q", tasks[0].Title)
	}
}

func TestNewWithPathNonexistentFile(t *testing.T) {
	s := NewWithPath("/nonexistent/path/tasks.json")
	if s == nil {
		t.Fatal("NewWithPath should not return nil for nonexistent file")
	}
	tasks := s.GetAll()
	if len(tasks) != 0 {
		t.Fatal("expected empty tasks for nonexistent file")
	}
}
