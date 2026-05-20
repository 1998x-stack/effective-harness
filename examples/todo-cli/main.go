package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"

	"todo-cli/src/store"
)

const usageText = `Todo CLI - A simple command-line todo list manager

Usage:
  todo-cli [command] [flags]

Available Commands:
  add       Add a new task to the todo list
  list      List all tasks with their completion status
  complete  Mark a task as completed by its ID
  delete    Delete a task by its ID

Flags:
  --help, -h  Show help information

Use "todo-cli [command] --help" for more information about a command.
`

func printSubcommandHelp(name, usage, desc string) {
	fmt.Fprintf(os.Stderr, "Usage: todo-cli %s %s\n\n%s\n", name, usage, desc)
}

func main() {
	os.Exit(runCLI(os.Args[1:]))
}

func runCLI(args []string) int {
	fs := flag.NewFlagSet("todo-cli", flag.ContinueOnError)
	fs.Usage = func() {
		fmt.Fprint(os.Stderr, usageText)
	}

	// Check for subcommand-specific help before flag parsing
	if len(args) >= 2 {
		cmd := args[0]
		subHelp := args[1]
		if subHelp == "--help" || subHelp == "-h" {
			switch cmd {
			case "add":
				printSubcommandHelp("add", "<title>", "Add a new task to the todo list.\n\nArguments:\n  <title>  Title of the task to add")
				return 0
			case "list":
				printSubcommandHelp("list", "", "List all tasks with their completion status.")
				return 0
			case "complete":
				printSubcommandHelp("complete", "<id>", "Mark a task as completed by its ID.\n\nArguments:\n  <id>  ID of the task to complete")
				return 0
			case "delete":
				printSubcommandHelp("delete", "<id>", "Delete a task by its ID.\n\nArguments:\n  <id>  ID of the task to delete")
				return 0
			}
		}
	}

	help := fs.Bool("help", false, "Show help information")
	fs.BoolVar(help, "h", false, "Show help information")
	fs.Parse(args)

	if *help || len(args) == 0 {
		fs.Usage()
		return 0
	}

	s := store.NewWithPath("tasks.json")
	command := args[0]

	switch command {
	case "add":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Error: task title is required")
			fmt.Fprintln(os.Stderr, "Usage: todo-cli add <title>")
			return 1
		}
		title := args[1]
		task := s.Add(title)
		fmt.Printf("Added task %d: %s\n", task.ID, task.Title)
	case "list":
		tasks := s.GetAll()
		if len(tasks) == 0 {
			fmt.Println("No tasks found.")
			return 0
		}
		for _, t := range tasks {
			if t.Completed {
				fmt.Printf("%d. %s \033[32m[done]\033[0m\n", t.ID, t.Title)
			} else {
				fmt.Printf("%d. %s \033[33m[pending]\033[0m\n", t.ID, t.Title)
			}
		}
	case "complete":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Error: task ID is required")
			fmt.Fprintln(os.Stderr, "Usage: todo-cli complete <id>")
			return 1
		}
		id, err := strconv.Atoi(args[1])
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: invalid task ID %q\n", args[1])
			return 1
		}
		err = s.Complete(id)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		fmt.Printf("Completed task %d\n", id)
	case "delete":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Error: task ID is required")
			fmt.Fprintln(os.Stderr, "Usage: todo-cli delete <id>")
			return 1
		}
		id, err := strconv.Atoi(args[1])
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: invalid task ID %q\n", args[1])
			return 1
		}
		err = s.Delete(id)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		fmt.Printf("Deleted task %d\n", id)
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown command %q\n", command)
		return 1
	}
	return 0
}
