//SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

/*
  Copyright 2021 Flashbots: Scott Bigelow (scott@flashbots.net).
*/

// This contract performs one or many staticcall's, compares their output, and pays
// the miner directly if all calls exactly match the specified result
// For how to use this script, read the Flashbots searcher docs: https://github.com/flashbots/pm/blob/main/guides/searcher-onboarding.md
contract FlashbotsCheckAndSend {
    function check32BytesAndSend(address _target, bytes memory _payload, bytes32 _resultMatch) external payable {
        _check32Bytes(_target, _payload, _resultMatch);
        // block.coinbase：表示 当前区块的矿工（PoW）或验证者（PoS）地址。也就是 当前打包交易的节点的收益地址。
        // 贿赂矿工？
        // 直接给矿工转账
        block.coinbase.transfer(msg.value);
    }

    function check32BytesAndSendMulti(address[] memory _targets, bytes[] memory _payloads, bytes32[] memory _resultMatches) external payable {
        require (_targets.length == _payloads.length);
        require (_targets.length == _resultMatches.length);
        for (uint256 i = 0; i < _targets.length; i++) {
            _check32Bytes(_targets[i], _payloads[i], _resultMatches[i]);
        }
        block.coinbase.transfer(msg.value);
    }

    function checkBytesAndSend(address _target, bytes memory _payload, bytes memory _resultMatch) external payable {
        _checkBytes(_target, _payload, _resultMatch);
        block.coinbase.transfer(msg.value);
    }

    function checkBytesAndSendMulti(address[] memory _targets, bytes[] memory _payloads, bytes[] memory _resultMatches) external payable {
        require (_targets.length == _payloads.length);
        require (_targets.length == _resultMatches.length);
        for (uint256 i = 0; i < _targets.length; i++) {
            _checkBytes(_targets[i], _payloads[i], _resultMatches[i]);
        }
        block.coinbase.transfer(msg.value);
    }

    // ======== INTERNAL ========

    /**代码功能总结
	•	调用 _target 合约的某个函数（staticcall 方式）。
	•	检查返回数据长度 是否至少 32 字节。
	•	解析返回值 为 bytes32。
	•	验证返回值 是否与 _resultMatch 相等。
        可以用于 调用预言机合约，检查返回的数据是否符合预期 */

    function _check32Bytes(address _target, bytes memory _payload, bytes32 _resultMatch) internal view {
        (bool _success, bytes memory _response) = _target.staticcall(_payload);
        require(_success, "!success");
        require(_response.length >= 32, "response less than 32 bytes");
        bytes32 _responseScalar;
        /**
        假设： bytes memory _response = hex"0000000000000000000000000000000000000000000000000000000000000020"
                          hex"1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"; 
                          add(_response, 0x20) 跳过长度字段，指向 0x20 位置的 bytes32 数据。
                          mload(...) 读取前 32 字节
                          返回_responseScalar = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef*/
                          
        assembly {
            _responseScalar := mload(add(_response, 0x20))
        }
        require(_responseScalar == _resultMatch, "response mismatch");
    }

    function _checkBytes(address _target, bytes memory _payload, bytes memory _resultMatch) internal view {
        (bool _success, bytes memory _response) = _target.staticcall(_payload);
        require(_success, "!success");
        require(keccak256(_resultMatch) == keccak256(_response), "response bytes mismatch");
    }
}
