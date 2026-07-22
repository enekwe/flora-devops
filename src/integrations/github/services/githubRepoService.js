const { Octokit } = require('@octokit/rest');
const githubAuthService = require('./githubAuthService');
const GitHubConnection = require('../models/GitHubConnection');
const logger = require('../../../config/logger');
const { AppError } = require('../../../middleware/errorHandler');

class GitHubRepoService {
  /**
   * Get Octokit instance with user's access token
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @returns {Octokit} Authenticated Octokit instance
   */
  async getOctokit(userId, organizationId) {
    const accessToken = await githubAuthService.getAccessToken(userId, organizationId);
    return new Octokit({ auth: accessToken });
  }

  /**
   * List user's repositories
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {Object} options - List options
   * @returns {Array} List of repositories
   */
  async listRepositories(userId, organizationId, options = {}) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = {
        visibility: options.visibility || 'all',
        affiliation: options.affiliation || 'owner,collaborator,organization_member',
        sort: options.sort || 'updated',
        direction: options.direction || 'desc',
        per_page: options.perPage || 30,
        page: options.page || 1
      };

      const response = await octokit.repos.listForAuthenticatedUser(params);

      // Update connection with repositories
      const connection = await GitHubConnection.findOne({ userId, organizationId });
      if (connection) {
        response.data.forEach(repo => connection.addRepository(repo));
        await connection.save();
      }

      return response.data.map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        private: repo.private,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
        language: repo.language,
        stargazersCount: repo.stargazers_count,
        forksCount: repo.forks_count,
        openIssuesCount: repo.open_issues_count,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
        pushedAt: repo.pushed_at
      }));
    } catch (error) {
      logger.error('Failed to list GitHub repositories:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list repositories',
        error.response?.status || 500
      );
    }
  }

  /**
   * Get repository details
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Object} Repository details
   */
  async getRepository(userId, organizationId, owner, repo) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);
      const response = await octokit.repos.get({ owner, repo });

      return {
        id: response.data.id,
        name: response.data.name,
        fullName: response.data.full_name,
        description: response.data.description,
        private: response.data.private,
        url: response.data.html_url,
        cloneUrl: response.data.clone_url,
        sshUrl: response.data.ssh_url,
        defaultBranch: response.data.default_branch,
        language: response.data.language,
        stargazersCount: response.data.stargazers_count,
        forksCount: response.data.forks_count,
        openIssuesCount: response.data.open_issues_count,
        size: response.data.size,
        createdAt: response.data.created_at,
        updatedAt: response.data.updated_at,
        pushedAt: response.data.pushed_at,
        permissions: response.data.permissions
      };
    } catch (error) {
      logger.error('Failed to get GitHub repository:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to get repository',
        error.response?.status || 500
      );
    }
  }

  /**
   * Create a new repository
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {Object} repoData - Repository data
   * @returns {Object} Created repository
   */
  async createRepository(userId, organizationId, repoData) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = {
        name: repoData.name,
        description: repoData.description || '',
        private: repoData.private !== undefined ? repoData.private : false,
        auto_init: repoData.autoInit !== undefined ? repoData.autoInit : false
      };

      if (repoData.gitignoreTemplate) {
        params.gitignore_template = repoData.gitignoreTemplate;
      }

      if (repoData.licenseTemplate) {
        params.license_template = repoData.licenseTemplate;
      }

      const response = await octokit.repos.createForAuthenticatedUser(params);

      logger.info(`GitHub repository created: ${response.data.full_name}`);

      return {
        id: response.data.id,
        name: response.data.name,
        fullName: response.data.full_name,
        description: response.data.description,
        private: response.data.private,
        url: response.data.html_url,
        cloneUrl: response.data.clone_url,
        defaultBranch: response.data.default_branch,
        createdAt: response.data.created_at
      };
    } catch (error) {
      logger.error('Failed to create GitHub repository:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to create repository',
        error.response?.status || 500
      );
    }
  }

  /**
   * Update repository settings
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} updates - Repository updates
   * @returns {Object} Updated repository
   */
  async updateRepository(userId, organizationId, owner, repo, updates) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = { owner, repo };

      if (updates.name) params.name = updates.name;
      if (updates.description !== undefined) params.description = updates.description;
      if (updates.private !== undefined) params.private = updates.private;
      if (updates.defaultBranch) params.default_branch = updates.defaultBranch;
      if (updates.hasIssues !== undefined) params.has_issues = updates.hasIssues;
      if (updates.hasProjects !== undefined) params.has_projects = updates.hasProjects;
      if (updates.hasWiki !== undefined) params.has_wiki = updates.hasWiki;

      const response = await octokit.repos.update(params);

      logger.info(`GitHub repository updated: ${response.data.full_name}`);

      return {
        id: response.data.id,
        name: response.data.name,
        fullName: response.data.full_name,
        description: response.data.description,
        private: response.data.private,
        url: response.data.html_url,
        updatedAt: response.data.updated_at
      };
    } catch (error) {
      logger.error('Failed to update GitHub repository:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to update repository',
        error.response?.status || 500
      );
    }
  }

  /**
   * Delete a repository
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   */
  async deleteRepository(userId, organizationId, owner, repo) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);
      await octokit.repos.delete({ owner, repo });

      logger.info(`GitHub repository deleted: ${owner}/${repo}`);

      return { message: 'Repository deleted successfully' };
    } catch (error) {
      logger.error('Failed to delete GitHub repository:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to delete repository',
        error.response?.status || 500
      );
    }
  }

  /**
   * Create or update a single file in a repository (used by App Kit to push
   * scaffolded/generated source into a build's repo).
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} filePath - Path within the repo, e.g. 'src/index.js'
   * @param {string} content - Raw file content (utf8)
   * @param {string} message - Commit message
   * @param {string} [branch] - Target branch; defaults to the repo's default branch
   * @returns {Object} { path, sha, commitSha }
   */
  async createOrUpdateFile(userId, organizationId, owner, repo, filePath, content, message, branch) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      let sha;
      try {
        const existing = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
        if (!Array.isArray(existing.data)) {
          sha = existing.data.sha;
        }
      } catch (error) {
        if (error.status !== 404) throw error; // anything but "doesn't exist yet" is a real failure
      }

      const response = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        sha
      });

      return {
        path: response.data.content?.path,
        sha: response.data.content?.sha,
        commitSha: response.data.commit?.sha
      };
    } catch (error) {
      logger.error('Failed to create/update GitHub file:', error);
      throw new AppError(
        error.response?.data?.message || `Failed to create/update file ${filePath}`,
        error.response?.status || 500
      );
    }
  }

  /**
   * List repository branches
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Array} List of branches
   */
  async listBranches(userId, organizationId, owner, repo) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);
      const response = await octokit.repos.listBranches({ owner, repo });

      return response.data.map(branch => ({
        name: branch.name,
        commit: {
          sha: branch.commit.sha,
          url: branch.commit.url
        },
        protected: branch.protected
      }));
    } catch (error) {
      logger.error('Failed to list GitHub branches:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list branches',
        error.response?.status || 500
      );
    }
  }

  /**
   * List repository commits
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - List options
   * @returns {Array} List of commits
   */
  async listCommits(userId, organizationId, owner, repo, options = {}) {
    try {
      const octokit = await this.getOctokit(userId, organizationId);

      const params = { owner, repo };
      if (options.sha) params.sha = options.sha;
      if (options.path) params.path = options.path;
      if (options.author) params.author = options.author;
      if (options.since) params.since = options.since;
      if (options.until) params.until = options.until;
      if (options.perPage) params.per_page = options.perPage;
      if (options.page) params.page = options.page;

      const response = await octokit.repos.listCommits(params);

      return response.data.map(commit => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: {
          name: commit.commit.author.name,
          email: commit.commit.author.email,
          date: commit.commit.author.date
        },
        committer: {
          name: commit.commit.committer.name,
          email: commit.commit.committer.email,
          date: commit.commit.committer.date
        },
        url: commit.html_url
      }));
    } catch (error) {
      logger.error('Failed to list GitHub commits:', error);
      throw new AppError(
        error.response?.data?.message || 'Failed to list commits',
        error.response?.status || 500
      );
    }
  }
}

module.exports = new GitHubRepoService();
