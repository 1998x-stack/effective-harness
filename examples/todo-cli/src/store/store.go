package store

import (
	"encoding/json"
	"fmt"
	"os"
)

// Task represents a single todo item.
type Task struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	Completed bool   `json:"completed"`
}

type storeData struct {
	Tasks  []Task `json:"tasks"`
	NextID int    `json:"nextID"`
}

// Store is a collection of tasks, optionally persisted to disk.
type Store struct {
	tasks    []Task
	nextID   int
	filePath string // empty means no persistence
}

// New creates a new in-memory Store with no file persistence.
func New() *Store {
	return &Store{
		tasks:  make([]Task, 0),
		nextID: 1,
	}
}

// NewWithPath creates a Store that persists to the given file path.
// If the file exists, tasks are loaded from it; otherwise an empty store is created.
func NewWithPath(filePath string) *Store {
	s := New()
	s.filePath = filePath
	s.load()
	return s
}

func (s *Store) save() error {
	if s.filePath == "" {
		return nil
	}
	sd := storeData{
		Tasks:  s.tasks,
		NextID: s.nextID,
	}
	data, err := json.MarshalIndent(sd, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, data, 0644)
}

func (s *Store) load() {
	if s.filePath == "" {
		return
	}
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return
	}
	var sd storeData
	if err := json.Unmarshal(data, &sd); err != nil {
		return
	}
	s.tasks = sd.Tasks
	s.nextID = sd.NextID
}

// Add inserts a new task with the given title and returns it.
func (s *Store) Add(title string) Task {
	task := Task{
		ID:        s.nextID,
		Title:     title,
		Completed: false,
	}
	s.nextID++
	s.tasks = append(s.tasks, task)
	s.save()
	return task
}

// GetAll returns a copy of all tasks.
func (s *Store) GetAll() []Task {
	result := make([]Task, len(s.tasks))
	copy(result, s.tasks)
	return result
}

// Complete marks the task with the given ID as completed.
// Returns an error if no task with that ID exists.
func (s *Store) Complete(id int) error {
	for i := range s.tasks {
		if s.tasks[i].ID == id {
			s.tasks[i].Completed = true
			s.save()
			return nil
		}
	}
	return fmt.Errorf("task with ID %d not found", id)
}

// Delete removes the task with the given ID from the store.
// Returns an error if no task with that ID exists.
func (s *Store) Delete(id int) error {
	for i, t := range s.tasks {
		if t.ID == id {
			s.tasks = append(s.tasks[:i], s.tasks[i+1:]...)
			s.save()
			return nil
		}
	}
	return fmt.Errorf("task with ID %d not found", id)
}
