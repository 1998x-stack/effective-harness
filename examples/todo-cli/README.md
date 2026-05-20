# Todo CLI

A simple command-line todo list manager written in Go. Tasks are persisted to disk as JSON.

## Installation

### Prerequisites

- [Go](https://go.dev/dl/) 1.21 or later

### Build from source

```bash
git clone <repo-url>
cd todo-cli
go build -o todo-cli .
```

### Quick start

```bash
# Add a task
./todo-cli add 'Buy groceries'

# List all tasks
./todo-cli list

# Mark a task as completed
./todo-cli complete 1

# Delete a task
./todo-cli delete 1
```

## Usage

### Global flags

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help information |

### Commands

#### `add <title>`

Add a new task to the todo list.

```bash
./todo-cli add 'Buy groceries'
# Output: Added task 1: Buy groceries
```

#### `list`

List all tasks with their completion status.

- Completed tasks are displayed with `[done]` in green.
- Pending tasks are displayed with `[pending]` in yellow.

```bash
./todo-cli list
# Output:
# 1. Buy groceries [done]
# 2. Write report [pending]
```

When no tasks exist:

```bash
./todo-cli list
# Output: No tasks found.
```

#### `complete <id>`

Mark a task as completed by its ID.

```bash
./todo-cli complete 1
# Output: Completed task 1
```

Error cases:

```bash
./todo-cli complete
# Error: task ID is required

./todo-cli complete abc
# Error: invalid task ID "abc"

./todo-cli complete 999
# Output: task with ID 999 not found
```

#### `delete <id>`

Delete a task by its ID.

```bash
./todo-cli delete 1
# Output: Deleted task 1
```

Error cases:

```bash
./todo-cli delete
# Error: task ID is required

./todo-cli delete abc
# Error: invalid task ID "abc"

./todo-cli delete 999
# Output: task with ID 999 not found
```

### Getting help

```bash
# General help
./todo-cli --help

# Subcommand-specific help
./todo-cli add --help
./todo-cli list --help
./todo-cli complete --help
./todo-cli delete --help
```

## Data storage

Tasks are saved to `tasks.json` in the current working directory. The file is created automatically when you add your first task.

## Development

```bash
# Build
go build -o todo-cli .

# Run tests
go test ./... -v

# Run tests with coverage
go test ./... -cover
```
