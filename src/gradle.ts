import * as core from '@actions/core'
import * as exec from '@actions/exec'
import semver from 'semver'

/**
 * Detects if the used gradle version supports `single properties`.
 * E.g. 7.5.0 or higher.
 */
export async function singlePropertySupport(useGradlew: boolean, gradleProjectPath: string): Promise<boolean> {
  const version = await fetchGradleVersion(useGradlew, gradleProjectPath)
  const semverVersion = semver.coerce(version)
  if (semverVersion) {
    if (semver.satisfies(semverVersion, '>=7.5.0')) {
      return true
    } else {
      core.warning(
        `The current gradle version does not support retrieving a single property. Found version: ${version}.`
      )
      return false
    }
  } else {
    throw new Error(`Failed to parse gradle version: ${version}`)
  }
}

/**
 * Fetches the version of gradle in use via the CLI.
 */
async function fetchGradleVersion(useGradlew: boolean, gradleProjectPath: string): Promise<string> {
  const command = retrieveGradleCLI(useGradlew)
  const versionOutput = await exec.getExecOutput(command, ['--version'], {
    cwd: gradleProjectPath,
    silent: !core.isDebug(),
    ignoreReturnCode: true
  })
  if (versionOutput.exitCode !== 0) {
    core.error(versionOutput.stderr)
    core.setFailed(`'${command} --version' command failed!`)
    throw new Error(`Failed to execute '${command} --version'`)
  }

  const output = versionOutput.stdout
  const version = output.match(/[\\S\\s]*?-\n(Gradle )(.+)\n-/)
  if (version != null) {
    return version[2]
  }
  if (core.isDebug()) {
    core.debug(`Failed to extract gradle version from: ${output}`)
  }
  throw new Error(`Failed to extract gradle version`)
}

/**
 * Retrieves all dependencies from gradle by running the `dependencies` task for the provided project module and configuration.
 */
export async function retrieveGradleDependencies(
  useGradlew: boolean,
  gradleProjectPath: string,
  gradleBuildModule: string,
  gradleBuildConfiguration: string | undefined
): Promise<string> {
  const start = Date.now()

  const command = retrieveGradleCLI(useGradlew)
  const module = verifyModule(gradleBuildModule)

  if (gradleBuildConfiguration !== undefined && gradleBuildConfiguration !== '') {
    const dependencyList = await exec.getExecOutput(
      command,
      [`--console`, `plain`, `${module}:dependencies`, '--configuration', gradleBuildConfiguration],
      {
        cwd: gradleProjectPath,
        silent: !core.isDebug(),
        ignoreReturnCode: true
      }
    )
    if (dependencyList.exitCode !== 0) {
      core.error(dependencyList.stderr)
      core.setFailed(
        `'${command} ${module}:dependencies --configuration ${gradleBuildConfiguration}' resolution failed!`
      )
      throw new Error(
        `Failed to execute '${command} ${module}:dependencies --configuration ${gradleBuildConfiguration}'`
      )
    }
    core.info(
      `Completed retrieving the 'dependencies' for configuration '${gradleBuildConfiguration}' within ${
        Date.now() - start
      }ms`
    )
    return dependencyList.stdout
  } else {
    const dependencyList = await exec.getExecOutput(command, [`--console`, `plain`, `${module}:dependencies`], {
      cwd: gradleProjectPath,
      silent: !core.isDebug(),
      ignoreReturnCode: true
    })
    if (dependencyList.exitCode !== 0) {
      core.error(dependencyList.stderr)
      core.setFailed(`'${command} ${module}:dependencies resolution failed!`)
      throw new Error(`Failed to execute '${command} ${module}:dependencies'`)
    }
    core.info(`Completed retrieving the 'dependencies' within ${Date.now() - start}ms`)
    return dependencyList.stdout
  }
}

/**
 * Retrieves the full build environment from gradle by running the `buildEnvironment` task for the provided project.
 */
export async function retrieveGradleBuildEnvironment(useGradlew: boolean, gradleProjectPath: string): Promise<string> {
  const start = Date.now()

  const command = retrieveGradleCLI(useGradlew)
  const dependencyList = await exec.getExecOutput(command, [`--console`, `plain`, `:buildEnvironment`], {
    cwd: gradleProjectPath,
    silent: !core.isDebug(),
    ignoreReturnCode: true
  })
  if (dependencyList.exitCode !== 0) {
    core.error(dependencyList.stderr)
    core.setFailed(`'${command} :buildEnvironment' resolution failed!`)
    throw new Error(`Failed to execute '${command} :buildEnvironment'`)
  }
  core.info(`Completed retrieving the 'buildEnvironment' within ${Date.now() - start}ms`)
  return dependencyList.stdout
}

/**
 * Retrieves the `buildFile` `property` from a given `module` name in the configured gradle project.
 */
export async function retrieveGradleBuildPath(
  useGradlew: boolean,
  gradleProjectPath: string,
  gradleBuildModule: string
): Promise<string | undefined> {
  return retrieveGradleProperty(useGradlew, gradleProjectPath, gradleBuildModule, 'buildFile')
}

/**
 * Retrieves the `name` `property` from the configured gradle project.
 */
export async function retrieveGradleProjectName(
  useGradlew: boolean,
  gradleProjectPath: string
): Promise<string | undefined> {
  return retrieveGradleProperty(useGradlew, gradleProjectPath, ':', 'name')
}

/**
 * Retrieves the `property` from a given `module` name
 */
async function retrieveGradleProperty(
  useGradlew: boolean,
  gradleProjectPath: string,
  gradleBuildModule: string,
  property: string
): Promise<string | undefined> {
  const singlePropertySupported = await singlePropertySupport(useGradlew, gradleProjectPath)

  const command = retrieveGradleCLI(useGradlew)
  const module = verifyModule(gradleBuildModule)

  let commandArgs = []
  if (singlePropertySupported) {
    commandArgs = [`${module}:properties`, '-q', '--property', property]
  } else {
    commandArgs = [`${module}:properties`, '-q']
  }

  const propertyOutput = await exec.getExecOutput(command, commandArgs, {
    cwd: gradleProjectPath,
    silent: !core.isDebug(),
    ignoreReturnCode: true
  })
  if (propertyOutput.exitCode !== 0) {
    core.error(propertyOutput.stderr)
    core.setFailed(`'${command} ${module}:properties' retrieval failed!`)
    throw new Error(`Failed to execute '${command} ${module}:properties'`)
  }

  const output = propertyOutput.stdout

  let matched = null

  if (singlePropertySupported) {
    matched = output.match(new RegExp(`[\\S\\s]*?(${property}: )(.+)\n`))
  } else {
    matched = output.split('\n').map(it => it.match(new RegExp(`[\\S\\s]*?(${property}: )(.+)`))).find(it=>it !== null)
  }

  if (matched !== null && matched !== undefined) {
    return matched[2]
  }

  core.warning(`Failed to retrieve the '${property}' for '${gradleBuildModule}'`)
  return undefined
}

/**
 * Returns the gradle cli configured for the action
 */
function retrieveGradleCLI(useGradlew: boolean): string {
  return useGradlew ? './gradlew' : 'gradle'
}

/**
 * Detect if a root module was passed, if yes we don't require `:` for the commands.
 */
function verifyModule(module: string): string {
  if (module === ':') {
    return ''
  } else {
    return module
  }
}
