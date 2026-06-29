/**
 * @fileoverview Tree-sitter based Dockerfile chunker splitting by each build instruction type.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Dockerfiles (.dockerfile, Dockerfile, .containerfile, Containerfile).
 * Uses tree-sitter to parse and split by each Dockerfile instruction type
 * (FROM, RUN, CMD, ENV, COPY, etc.).
 */
export class DockerfileChunker extends TreeSitterChunker {
  readonly language = "dockerfile";
  readonly fileExtensions = [".dockerfile", "dockerfile", ".containerfile", "containerfile"];
  readonly grammarName = "dockerfile";
  readonly nodeTypes = new Set([
    "from_instruction",
    "run_instruction",
    "cmd_instruction",
    "entrypoint_instruction",
    "env_instruction",
    "arg_instruction",
    "workdir_instruction",
    "copy_instruction",
    "add_instruction",
    "expose_instruction",
    "volume_instruction",
    "user_instruction",
    "label_instruction",
    "healthcheck_instruction",
    "shell_instruction",
    "stopsignal_instruction",
    "onbuild_instruction",
    "maintainer_instruction",
    "cross_build_instruction",
  ]);
}

/** Default singleton instance of {@link DockerfileChunker}. */
export const dockerfileChunker = new DockerfileChunker();
