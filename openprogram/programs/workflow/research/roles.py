"""The roles of the research workflow.

A role without a model runs on the caller's model. To review or judge
with a different model, configure the role before running, for example
``roles.reviewer.model = "openai:gpt-5"``.
"""

from openprogram import Agent

author = Agent(tools=[])
experimenter = Agent(tools=["read", "write", "edit", "bash"], max_iterations=20)
reviewer = Agent(tools=[])
evaluator = Agent(tools=[])
