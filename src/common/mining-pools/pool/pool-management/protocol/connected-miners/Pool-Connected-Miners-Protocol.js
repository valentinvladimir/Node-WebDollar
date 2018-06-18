import NodesWaitlist from 'node/lists/waitlist/Nodes-Waitlist'
import NodesList from 'node/lists/Nodes-List';
import NODE_TYPE from "node/lists/types/Node-Type";
import NODE_CONSENSUS_TYPE from "node/lists/types/Node-Consensus-Type"
import PoolsUtils from "common/mining-pools/common/Pools-Utils"
import PoolProtocolList from "common/mining-pools/common/Pool-Protocol-List"
import consts from 'consts/const_global'
import InterfaceBlockchainAddressHelper from "common/blockchain/interface-blockchain/addresses/Interface-Blockchain-Address-Helper";
import ed25519 from "common/crypto/ed25519";
import Serialization from 'common/utils/Serialization';
import Blockchain from "main-blockchain/Blockchain";

class PoolConnectedMinersProtocol extends PoolProtocolList{

    constructor(poolManagement){

        super();

        this.poolManagement = poolManagement;

        this.connectedMiners = [];
        this.list = this.connectedMiners;

    }

    async startPoolConnectedMinersProtocol(){

        NodesList.emitter.on("nodes-list/connected", async (nodesListObject) => {
            await this._subscribePoolConnectedMiners(nodesListObject)
        });

        for (let i=0; i<NodesList.nodes.length; i++)
            await this._subscribePoolConnectedMiners(NodesList.nodes[i]);

    }

    async _subscribePoolConnectedMiners(nodesListObject){

        let socket = nodesListObject.socket;

        if (!this.poolManagement.poolStarted) return false;

        if ( !(socket.node.protocol.nodeType === NODE_TYPE.NODE_TERMINAL && socket.node.protocol.nodeConsensusType === NODE_CONSENSUS_TYPE.NODE_CONSENSUS_POOL ||
             socket.node.protocol.nodeType === NODE_TYPE.NODE_WEB_PEER && socket.node.protocol.nodeConsensusType === NODE_CONSENSUS_TYPE.NODE_CONSENSUS_SERVER_FOR_MINER )){

            return false;

        }


        socket.node.on("mining-pool/hello-pool", async (data) => {

            try{

                if ( !Buffer.isBuffer( data.message )  || data.message.length !== 32) throw {message: "message is invalid"};
                if ( !Buffer.isBuffer( data.poolPublicKey )  || data.poolPublicKey.length !== consts.ADDRESSES.PUBLIC_KEY.LENGTH) throw {message: "poolPublicKey is invalid"};

                //validate poolPublicKey
                if ( ! data.poolPublicKey.equals( this.poolManagement.poolSettings.poolPublicKey )) throw {message: "poolPublicKey doesn't match"};

                if ( !Buffer.isBuffer( data.minerPublicKey )  || data.minerPublicKey.length !== consts.ADDRESSES.PUBLIC_KEY.LENGTH) throw {message: "minerPublicKey is invalid"};

                if ( typeof data.minerAddress !== "string" ) throw { message: "minerAddress is not correct" };
                let unencodedAddress = InterfaceBlockchainAddressHelper.getUnencodedAddressFromWIF( data.minerAddress );
                if (unencodedAddress === null) throw { message: "minerAddress is not correct" };

                //validate minerPool signature
                if ( !Buffer.isBuffer( data.messageSignature ) || data.messageSignature.length < 10) throw {message: "messageSignature is invalid"};
                if ( !ed25519.verify(data.messageSignature, data.message, data.minerPublicKey)) throw {message: "messageSignature doesn't validate message"}


                // save minerPublicKey
                let miner = this.poolManagement.poolData.getMiner(unencodedAddress);

                if (miner === null )
                    miner = await this.poolManagement.poolData.addMiner(unencodedAddress, data.minerPublicKey);

                miner.addInstance(data.minerPublicKey);

                let signature = this.poolManagement.poolSettings.poolDigitalSign(data.message);


                //in case there is an suffix in the answer
                let suffix = "";
                if ( typeof data.suffix === "string")
                    suffix = '/'+data.suffix;

                let confirmation = await socket.node.sendRequestWaitOnce("mining-pool/hello-pool/answer"+suffix, {
                    result: true,
                    signature: signature,
                }, "confirmation" );

                try {

                    if (confirmation === null) throw {message: "confirmation is empty"};

                    if (!confirmation.result) throw {message: "confirmation is false"};

                    if (confirmation.result){

                        this._addConnectedMinerPool(socket, confirmation.sckAddress || socket.node.sckAddress.address );

                    }

                } catch (exception){

                }

            } catch (exception){

                socket.node.sendRequest("mining-pool/hello-pool"+"/answer", {result: false, message: exception.message, } );
            }

        });



        socket.node.on("mining-pool/get-work", async (data) => {

            try {

                if (!Buffer.isBuffer( data.minerPublicKey )  || data.minerPublicKey.length !== consts.ADDRESSES.PUBLIC_KEY.LENGTH) throw {message: "minerPublicKey is invalid"};
                if (!Buffer.isBuffer( data.poolPublicKey )  || data.poolPublicKey.length !== consts.ADDRESSES.PUBLIC_KEY.LENGTH) throw {message: "poolPublicKey is invalid"};
                if (! data.poolPublicKey.equals(Blockchain.PoolManagement.poolSettings.poolPublicKey )) throw {message: "poolPublicKey is invalid"};

                let minerInstance = this.poolManagement.poolData.getMinerInstanceByPublicKey(data.minerPublicKey);
                if (minerInstance === null) throw {message: "publicKey was not found"};

                let work = await this.poolManagement.generatePoolWork(minerInstance);

                let message = Buffer.concat( [ work.serialization, Serialization.serializeNumber4Bytes( work.start ), Serialization.serializeNumber4Bytes( work.end ) ]);
                let signature = this.poolManagement.poolSettings.poolDigitalSign(message);

                work.serialization = undefined; //don't send the data 2 times

                //in case there is an suffix in the answer
                let suffix = "";
                if ( typeof data.suffix === "string")
                    suffix = '/'+data.suffix;

                socket.node.sendRequest("mining-pool/get-work/answer"+suffix, {result: true, work: work, signature: signature } )

            } catch (exception){

                socket.node.sendRequest("mining-pool/get-work/answer", {result: false, message: exception.message } );

            }

        });



        socket.node.on("mining-pool/work-done", async (data) => {

            try{

                if (Buffer.isBuffer( data.minerPublicKey )  || data.minerPublicKey.length !== consts.ADDRESSES.PUBLIC_KEY.LENGTH) throw {message: "minerPublicKey is invalid"};

                let minerInstance = this.poolManagement.poolData.getMinerInstanceByPublicKey(data.minerPublicKey);
                if (minerInstance === null) throw {message: "publicKey was not found"};

                let answer = await this.poolManagement.receivePoolWork(minerInstance, data.work);

                let newWork = await this.poolManagement.generatePoolWork(minerInstance);

                let message = Buffer.concat( [ newWork.block.serialization, Serialization.serializeNumber4Bytes( newWork.start ), Serialization.serializeNumber4Bytes( newWork.end ) ]);
                let signature = this.poolManagement.poolSettings.poolDigitalSign(message);

                newWork.serialization = undefined;

                socket.node.sendRequest("mining-pool/work-done"+"/answer", {result: true, answer: answer.result, reward: answer.reward, newWork: newWork, signature: signature } ); //the new reward

            } catch (exception){
                socket.node.sendRequest("mining-pool/work-done"+"/answer", {result: false, message: exception.message } )
            }

        });



        //TODO change-wallet
        socket.node.on("mining-pool/change-wallet", (data) => {

            try{

                if (Buffer.isBuffer( data.address )  || data.address.length !== consts.ADDRESSES.ADDRESS.LENGTH) throw {message: "address is invalid"};
                if (Buffer.isBuffer( data.publicKey)  || data.publicKey.length !== consts.ADDRESSES.PUBLIC_KEY.LENGTH) throw {message: "publicKey is invalid"};

                let miner = this.poolManagement.poolData.getMiner(data.address);
                if (miner === null) throw {message: "mine was not found"};



            } catch (exception){
                socket.node.sendRequest("mining-pool/change-wallet"+"/answer", {result: false, message: exception.message } )
            }

        });

        //TODO request reward
        socket.node.on("mining-pool/request-reward", async (data) => {

            try {

                if (Buffer.isBuffer( data.minerAddress )  || data.minerAddress.length !== consts.ADDRESSES.ADDRESS.LENGTH) throw {message: "minerAddress is invalid"};

                // load minerPublicKey
                let miner = this.poolManagement.poolData.getMiner(data.minerAddress);
                if (miner === null) throw {message: "mine was not found"};

                let answer = await this.poolManagement.sendReward(data.minerAddress);

                socket.node.sendRequest("mining-pool/request-reward"+"/answer", {result: answer } )

            } catch (exception) {
                socket.node.sendRequest("mining-pool/request-reward"+"/answer", {result: false, message: exception.message } )
            }
        });

    }



    _addConnectedMinerPool(socket, socketAddress){

        socket.node.protocol.minerPool = {
            socketAddress: socketAddress,
        };

        socket.node.protocol.nodeConsensusType = NODE_CONSENSUS_TYPE.NODE_CONSENSUS_MINER_POOL;

        this.addElement(socket);

    }

}

export default PoolConnectedMinersProtocol;